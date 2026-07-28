// =========================================================
// ARCHIVO: index.js
// =========================================================

const express = require('express');
const path = require('path');
const app = express();

app.use(express.json());

// Configuramos la carpeta pública e indicamos que index.html es la portada por defecto
app.use(express.static(path.join(__dirname, 'src/publico'), { index: 'index.html' }));

// Rutas de la API (Buscador y Registro POST)
const rutasAlumnos = require('./src/rutas/alumnosRutas');
app.use('/api/alumnos', rutasAlumnos);

const PUERTO = 3000;
app.listen(PUERTO, () => {
  console.log(`🚀 Sistema del Liceo Asilva disponible en: http://localhost:${PUERTO}`);
});