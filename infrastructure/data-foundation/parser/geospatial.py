"""GDAL readers restricted to admitted local format groups and declared coordinates."""

import json
import math
from itertools import pairwise

from osgeo import gdal, ogr, osr
from parser import MAX_EXPANDED_BYTES, ParseError, record, schema

gdal.UseExceptions()
ogr.UseExceptions()
osr.UseExceptions()
gdal.SetConfigOption("PROJ_NETWORK", "OFF")
gdal.SetConfigOption("GDAL_PAM_ENABLED", "NO")


def finite_json(value):
    if isinstance(value, float) and not math.isfinite(value):
        return str(value)
    if isinstance(value, dict):
        return {key: finite_json(item) for key, item in value.items()}
    if isinstance(value, (list, tuple)):
        return [finite_json(item) for item in value]
    return value


def transformation(source):
    if source is None:
        return None, "UNKNOWN_CRS"
    source = source.Clone()
    source.SetAxisMappingStrategy(osr.OAMS_TRADITIONAL_GIS_ORDER)
    target = osr.SpatialReference()
    target.ImportFromEPSG(4326)
    target.SetAxisMappingStrategy(osr.OAMS_TRADITIONAL_GIS_ORDER)
    options = osr.CoordinateTransformationOptions()
    options.SetBallparkAllowed(False)
    try:
        transform = osr.CreateCoordinateTransformation(source, target, options)
        return (transform, None) if transform else (None, "TRANSFORM_UNAVAILABLE")
    except RuntimeError:
        return None, "TRANSFORM_UNAVAILABLE"


def verified_geometry(geometry, transform):
    if geometry is None:
        return None, None
    if transform is None:
        return None, None
    candidate = geometry.Clone()
    try:
        if not candidate.IsValid() or candidate.Transform(transform) != 0:
            return None, "INVALID_GEOMETRY"
        if not candidate.IsValid():
            return None, "INVALID_GEOMETRY"
        west, east, south, north = candidate.GetEnvelope()
        if (
            not all(math.isfinite(v) for v in (west, east, south, north))
            or west < -180.00000001
            or east > 180.00000001
            or south < -90.00000001
            or north > 90.00000001
        ):
            return None, "TRANSFORM_UNAVAILABLE"
        value = json.loads(candidate.ExportToJson())

        # Normalize only floating-point noise at the legal WGS84 boundary.
        def position(value):
            if value and isinstance(value[0], (int, float)):
                return [
                    max(-180, min(180, value[0])),
                    max(-90, min(90, value[1])),
                    *value[2:],
                ]
            return [position(child) for child in value]

        if "coordinates" in value:
            value["coordinates"] = position(value["coordinates"])
        return value, None
    except (RuntimeError, ValueError):
        return None, "INVALID_GEOMETRY"


def shapefile(path):
    companions = {
        entry.name.lower(): entry for entry in path.parent.iterdir() if entry.is_file()
    }
    if any(
        f"{path.stem}{suffix}".lower() not in companions for suffix in (".dbf", ".shx")
    ):
        raise ParseError("MISSING_COMPANION")
    with gdal.OpenEx(
        str(path), gdal.OF_VECTOR, allowed_drivers=["ESRI Shapefile"]
    ) as source:
        layer = source.GetLayer(0)
        definition = layer.GetLayerDefn()
        labels = [
            definition.GetFieldDefn(index).GetName()
            for index in range(definition.GetFieldCount())
        ]
        yield schema(
            labels,
            (
                {"key": "__layer", "label": "Source layer"},
                {"key": "__geometry", "label": "Original geometry"},
                {"key": "__crs", "label": "Original CRS"},
            ),
        )
        crs = layer.GetSpatialRef()
        transform, reason = transformation(crs)
        for feature in layer:
            geometry = feature.GetGeometryRef()
            original = json.loads(geometry.ExportToJson()) if geometry else None
            mapped, geometry_reason = verified_geometry(geometry, transform)
            reason = geometry_reason or reason
            values = {
                f"c{index + 1}": finite_json(feature.GetField(index))
                for index in range(len(labels))
            }
            values.update(
                {
                    "__layer": layer.GetName(),
                    "__geometry": original,
                    "__crs": crs.ExportToWkt() if crs else None,
                }
            )
            yield record(
                values, mapped, str(feature.GetFID()), "EPSG:4326" if mapped else None
            )
        if reason:
            yield {"type": "warning", "reason": reason}


def footprint(source):
    transform, reason = transformation(source.GetSpatialRef())
    affine = source.GetGeoTransform(can_return_null=True)
    if affine is None:
        return None, "NO_GEOREFERENCE"
    ring = ogr.Geometry(ogr.wkbLinearRing)
    width, height = source.RasterXSize, source.RasterYSize
    # Densify projected boundaries rather than connecting only transformed corners.
    corners = [(0, 0), (width, 0), (width, height), (0, height), (0, 0)]
    for start, end in pairwise(corners):
        for step in range(16):
            x = start[0] + (end[0] - start[0]) * step / 16
            y = start[1] + (end[1] - start[1]) * step / 16
            ring.AddPoint_2D(
                affine[0] + x * affine[1] + y * affine[2],
                affine[3] + x * affine[4] + y * affine[5],
            )
    ring.CloseRings()
    polygon = ogr.Geometry(ogr.wkbPolygon)
    polygon.AddGeometry(ring)
    mapped, geometry_reason = verified_geometry(polygon, transform)
    return mapped, geometry_reason or reason


def raster(path, kind):
    import numpy as np

    with gdal.OpenEx(
        str(path.parent if kind == "adf" else path),
        gdal.OF_RASTER,
        allowed_drivers=["AIG"] if kind == "adf" else ["GTiff"],
    ) as source:
        if source.RasterCount > 256:
            raise ParseError("COLUMN_LIMIT")
        yield schema(
            ["Band", "Band metadata", "Values"],
            ({"key": "__kind", "label": "Content kind"},),
        )
        mapped, reason = footprint(source)
        size = source.RasterXSize * source.RasterYSize
        expanded = 0
        for number in range(1, source.RasterCount + 1):
            band = source.GetRasterBand(number)
            expanded += size * max(1, gdal.GetDataTypeSize(band.DataType) // 8)
            if expanded > MAX_EXPANDED_BYTES:
                raise ParseError("CAPACITY_LIMIT")
            values = None
            # Read all source pixels in bounded strips, detecting truncated blocks.
            strip_height = max(1, min(256, 1048576 // max(1, source.RasterXSize)))
            for y in range(0, source.RasterYSize, strip_height):
                block = band.ReadAsArray(
                    0, y, source.RasterXSize, min(strip_height, source.RasterYSize - y)
                )
                if block is None:
                    raise ParseError("INVALID_CONTENT")
                if size <= 65536:
                    mask = band.GetMaskBand().ReadAsArray(
                        0, y, source.RasterXSize, block.shape[0]
                    )
                    clean = np.where(
                        (mask != 0) & np.isfinite(block), block, None
                    ).tolist()
                    values = (values or []) + clean
            if values is None:
                reason = reason or "RASTER_VALUES_NOT_INDEXED"
            metadata = {
                "size": [source.RasterXSize, source.RasterYSize],
                "dataType": gdal.GetDataTypeName(band.DataType),
                "unit": band.GetUnitType() or None,
                "nodata": finite_json(band.GetNoDataValue()),
                "scale": band.GetScale(),
                "offset": band.GetOffset(),
                "crs": source.GetProjection() or None,
                "geotransform": source.GetGeoTransform(can_return_null=True),
                "layout": source.GetMetadata("IMAGE_STRUCTURE"),
                "blockSize": band.GetBlockSize(),
                "maskFlags": band.GetMaskFlags(),
                "pixelContentValidated": True,
            }
            yield record(
                {"c1": number, "c2": metadata, "c3": values, "__kind": "RASTER_BAND"},
                mapped,
                str(number),
                "EPSG:4326" if mapped else None,
            )
        if reason:
            yield {"type": "warning", "reason": reason}


def netcdf(path):
    import numpy as np

    with gdal.OpenEx(
        str(path), gdal.OF_MULTIDIM_RASTER, allowed_drivers=["netCDF"]
    ) as source:
        yield schema(
            ["Variable", "Variable metadata", "Values"],
            ({"key": "__kind", "label": "Content kind"},),
        )
        count = 0
        total = 0
        reason = None

        def groups(group, depth=0):
            if depth > 8:
                raise ParseError("CAPACITY_LIMIT")
            yield group
            for name in group.GetGroupNames() or []:
                yield from groups(group.OpenGroup(name), depth + 1)

        for group in groups(source.GetRootGroup()):
            for name in group.GetMDArrayNames() or []:
                count += 1
                if count > 256:
                    raise ParseError("COLUMN_LIMIT")
                array = group.OpenMDArray(name)
                dimensions = array.GetDimensions()
                size = math.prod(dimension.GetSize() for dimension in dimensions)
                total += size * max(8, array.GetDataType().GetSize())
                if total > MAX_EXPANDED_BYTES:
                    raise ParseError("CAPACITY_LIMIT")
                metadata = {
                    "dimensions": [
                        {
                            "name": dimension.GetFullName(),
                            "size": dimension.GetSize(),
                            "type": dimension.GetType(),
                            "direction": dimension.GetDirection(),
                        }
                        for dimension in dimensions
                    ],
                    "unit": array.GetUnit() or None,
                    "nodata": finite_json(array.GetNoDataValue()),
                    "attributes": {
                        attribute.GetName(): finite_json(attribute.Read())
                        for attribute in array.GetAttributes()
                    },
                    "crs": array.GetSpatialRef().ExportToWkt()
                    if array.GetSpatialRef()
                    else None,
                }
                values = None
                if size <= 65536:
                    if array.GetDataType().GetClass() == gdal.GEDTC_STRING:
                        strings = array.Read()
                        raw = np.array(strings, dtype=object).reshape(
                            tuple(dimension.GetSize() for dimension in dimensions)
                        )
                    else:
                        raw = array.ReadAsArray()
                    if raw is None:
                        raise ParseError("INVALID_CONTENT")
                    if np.issubdtype(raw.dtype, np.number):
                        nodata = array.GetNoDataValue()
                        valid = np.isfinite(raw)
                        if nodata is not None:
                            valid &= raw != nodata
                        values = np.where(valid, raw, None).tolist()
                    else:
                        values = raw.tolist()
                else:
                    reason = "NETCDF_VALUES_NOT_INDEXED"
                yield record(
                    {
                        "c1": array.GetFullName(),
                        "c2": metadata,
                        "c3": values,
                        "__kind": "NETCDF_VARIABLE",
                    }
                )
        if reason:
            yield {"type": "warning", "reason": reason}


def parse_geospatial(path, kind):
    gdal.PushErrorHandler("CPLQuietErrorHandler")
    try:
        if kind == "shp":
            yield from shapefile(path)
        elif kind == "nc":
            yield from netcdf(path)
        else:
            yield from raster(path, kind)
    except RuntimeError as error:
        raise ParseError("INVALID_CONTENT") from error
    finally:
        gdal.PopErrorHandler()
