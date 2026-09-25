# GPX → KML

Convierte archivos GPX a KML en el navegador. Sin servidor: el archivo no se sube a ningún lado.

## Uso

1. Abre [https://miguelcarrascoq.github.io/gpx-to-kml/](https://miguelcarrascoq.github.io/gpx-to-kml/)
2. Arrastra un `.gpx` o elígelo con el selector
3. Descarga el `.kml` generado

Compatible con tracks de Insta360 Studio, Garmin y otros exportadores GPX 1.0/1.1 (tracks, rutas y waypoints).

## Local

Sirve la carpeta con cualquier servidor estático, por ejemplo:

```bash
python3 -m http.server 8080
```

Abre `http://localhost:8080`.

## Licencia

MIT
