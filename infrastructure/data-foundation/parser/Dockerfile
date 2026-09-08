FROM ghcr.io/astral-sh/uv:0.12.10@sha256:2bb3ebca0a796a155094a27773d290c4b074572e6107f171d88d086682fd2500 AS uv
FROM ghcr.io/osgeo/gdal:ubuntu-full-3.13.3@sha256:2dd0f81ef927ff4c3d4dbe4f73c029dc86d4073974c0564f8e196f6e1412e2e0

COPY --from=uv /uv /usr/local/bin/uv
WORKDIR /opt/wiser-parser
COPY requirements.txt .
RUN uv venv --python /usr/bin/python3 --system-site-packages --no-python-downloads /opt/wiser-venv \
  && uv pip install --python /opt/wiser-venv/bin/python --require-hashes -r requirements.txt \
  && uv cache clean \
  && rm /usr/local/bin/uv
ENV PATH=/opt/wiser-venv/bin:${PATH}
ENV PYTHONDONTWRITEBYTECODE=1 PYTHONUNBUFFERED=1 OMP_NUM_THREADS=1 GDAL_CACHEMAX=64 PROJ_NETWORK=OFF
COPY parser.py server.py test_parser.py test_server.py ./
RUN python -c 'from osgeo import gdal; import openpyxl, xlrd, pypdf; assert gdal.VersionInfo() == "3130300"'
USER 65532:65532
EXPOSE 3005
CMD ["python", "server.py"]
