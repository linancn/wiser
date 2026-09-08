"""Geospatial content, coordinate and completeness boundaries in the pinned GDAL image."""

import json
import tempfile
import unittest
from pathlib import Path

from osgeo import gdal, ogr, osr
from parser import ParseError, parse_asset

gdal.UseExceptions()
ogr.UseExceptions()
osr.UseExceptions()


class GeospatialTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.root = Path(self.directory.name)

    def tearDown(self):
        self.directory.cleanup()

    def shape(self, declared=True):
        path = self.root / "stations.shp"
        source = ogr.GetDriverByName("ESRI Shapefile").CreateDataSource(str(path))
        crs = osr.SpatialReference()
        crs.ImportFromEPSG(4326)
        layer = source.CreateLayer("stations", crs if declared else None, ogr.wkbPoint)
        layer.CreateField(ogr.FieldDefn("station", ogr.OFTString))
        feature = ogr.Feature(layer.GetLayerDefn())
        feature.SetField("station", "001")
        point = ogr.Geometry(ogr.wkbPoint)
        point.AddPoint_2D(116.3, 39.9)
        feature.SetGeometry(point)
        layer.CreateFeature(feature)
        source = None
        return path

    def test_shape_reads_companions_and_verifies_axis_order(self):
        result = list(parse_asset(self.shape(), "shp"))
        record = next(event for event in result if event["type"] == "record")
        self.assertEqual(record["values"]["c1"], "001")
        self.assertEqual(
            record["geometry"], {"type": "Point", "coordinates": [116.3, 39.9]}
        )
        self.assertEqual(record["sourceCrs"], "EPSG:4326")
        self.assertEqual(result[-1]["featureCount"], 1)
        self.assertEqual(result[-1]["status"], "READY")

    def test_shape_without_crs_retains_original_geometry_without_map_claim(self):
        result = list(parse_asset(self.shape(False), "shp"))
        record = next(event for event in result if event["type"] == "record")
        self.assertIsNone(record["geometry"])
        self.assertEqual(record["values"]["__geometry"]["coordinates"], [116.3, 39.9])
        self.assertEqual(result[-1]["status"], "PARTIAL")
        self.assertEqual(result[-1]["reason"], "UNKNOWN_CRS")
        self.assertEqual(result[-1]["featureCount"], 0)

    def test_shape_requires_its_attribute_companion(self):
        path = self.shape()
        path.with_suffix(".dbf").unlink()
        with self.assertRaisesRegex(ParseError, "MISSING_COMPANION"):
            list(parse_asset(path, "shp"))

    def raster(self):
        path = self.root / "elevation.tif"
        source = gdal.GetDriverByName("GTiff").Create(
            str(path), 2, 2, 1, gdal.GDT_Int16
        )
        source.SetGeoTransform([116, 0.1, 0, 40, 0, -0.1])
        crs = osr.SpatialReference()
        crs.ImportFromEPSG(4326)
        source.SetProjection(crs.ExportToWkt())
        band = source.GetRasterBand(1)
        band.SetNoDataValue(-9999)
        band.SetUnitType("m")
        import numpy as np

        band.WriteArray(np.array([[0, 1], [-9999, 3]], dtype=np.int16))
        source = None
        return path

    def test_raster_keeps_band_units_nodata_values_and_verified_footprint(self):
        result = list(parse_asset(self.raster(), "tif"))
        record = next(event for event in result if event["type"] == "record")
        self.assertEqual(record["values"]["c2"]["unit"], "m")
        self.assertEqual(record["values"]["c2"]["nodata"], -9999)
        self.assertEqual(record["values"]["c3"], [[0, 1], [None, 3]])
        self.assertEqual(record["geometry"]["type"], "Polygon")
        self.assertEqual(result[-1]["status"], "READY")

    def test_a_truncated_raster_is_not_marked_ready(self):
        path = self.raster()
        path.write_bytes(path.read_bytes()[:20])
        with self.assertRaisesRegex(ParseError, "INVALID_CONTENT"):
            list(parse_asset(path, "tif"))

    def test_netcdf_string_coordinates_preserve_leading_zeroes(self):
        path = self.root / "experiment.nc"
        source = gdal.GetDriverByName("netCDF").CreateMultiDimensional(str(path))
        group = source.GetRootGroup()
        dimension = group.CreateDimension("time", "TEMPORAL", "", 2)
        array = group.CreateMDArray(
            "experiment", [dimension], gdal.ExtendedDataType.CreateString()
        )
        array.Write(["0001", "0002"])
        source = None
        result = list(parse_asset(path, "nc"))
        row = next(event for event in result if event["type"] == "record")
        self.assertEqual(row["values"]["c3"], ["0001", "0002"])

    def test_netcdf_preserves_dimensions_units_and_missing_values(self):
        path = self.root / "temperature.nc"
        raster = gdal.Open(str(self.raster()))
        gdal.Translate(str(path), raster, format="netCDF")
        result = list(parse_asset(path, "nc"))
        records = [event for event in result if event["type"] == "record"]
        self.assertTrue(
            any(record["values"]["c2"].get("dimensions") for record in records)
        )
        self.assertIn("-9999", json.dumps(records))
        self.assertTrue(any(record["values"]["c3"] is not None for record in records))
        self.assertEqual(result[-1]["recordCount"], len(records))


if __name__ == "__main__":
    unittest.main()
