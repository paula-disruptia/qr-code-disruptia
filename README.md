# Creador de Códigos QR

Aplicación web sencilla para generar códigos QR a partir de un enlace (o cualquier texto) y personalizarlos con colores. Todo se genera **en el navegador**, sin depender de servidores ni de librerías externas: los datos nunca salen de tu equipo.

## Características

- **Enlace o texto libre**: URLs, `mailto:`, `tel:`, texto plano, etc. (soporta UTF-8/acentos).
- **Colores personalizables**: color del código y del fondo, con selector visual y campo hexadecimal.
- **Combinaciones sugeridas**: paletas listas para usar con un clic.
- **Nivel de corrección de errores**: Baja (7%), Media (15%), Alta (25%), Máxima (30%).
- **Margen ajustable** (zona de silencio).
- **Advertencia de contraste** cuando la combinación de colores podría no escanearse bien.
- **Descarga en PNG** (alta resolución, ideal para web/redes) y **SVG** (vectorial, ideal para impresión).

## Uso

Abre `index.html` en cualquier navegador moderno. No requiere instalación ni conexión a internet.

Para publicarlo en la web basta con servir estos dos archivos:

```
index.html
qrcode.js
```

Por ejemplo, con un servidor local:

```bash
python3 -m http.server 8000
# luego abre http://localhost:8000
```

## Archivos

- `index.html` — interfaz y lógica de la aplicación.
- `qrcode.js` — motor de generación de códigos QR (modo byte, versiones 1–40, niveles L/M/Q/H) autocontenido, sin dependencias.

## Notas técnicas

El generador implementa el estándar QR (ISO/IEC 18004): aritmética en GF(256), corrección de errores Reed–Solomon, selección automática de versión y elección de máscara por penalización. La salida se ha validado decodificando los códigos generados con un lector independiente.
