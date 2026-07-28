// =========================================================
// ARCHIVO: src/rutas/alumnosRutas.js
// OBJETIVO: Operaciones CRUD usando SQLite
// =========================================================

const express = require('express');
const router = express.Router();
const db = require('../datos/bd');

// Función auxiliar para calcular promedio en escala chilena
function calcularPromedio(cadenaNotas) {
  if (!cadenaNotas) return 6.0;
  const arreglo = cadenaNotas.split(',').map(n => parseFloat(n.trim())).filter(n => !isNaN(n));
  if (arreglo.length === 0) return 6.0;
  const suma = arreglo.reduce((a, b) => a + b, 0);
  return parseFloat((suma / arreglo.length).toFixed(1));
}

// 1. GET: Obtener todos los alumnos
router.get('/', (req, res) => {
  db.all("SELECT * FROM alumnos", [], (err, filas) => {
    if (err) return res.status(500).json({ exito: false, mensaje: err.message });
    res.json({ exito: true, total: filas.length, datos: filas });
  });
});

// 2. GET: Buscar alumno por RUT
router.get('/rut/:rutBuscado', (req, res) => {
  const rutIngresado = req.params.rutBuscado;

  db.get("SELECT * FROM alumnos WHERE rut = ?", [rutIngresado], (err, alumno) => {
    if (err) return res.status(500).json({ exito: false, mensaje: err.message });

    if (alumno) {
      res.json({
        exito: true,
        alumno: {
          ...alumno,
          promedioCalculado: calcularPromedio(alumno.notas)
        }
      });
    } else {
      res.status(404).json({ exito: false, mensaje: 'Estudiante no encontrado en la Base de Datos.' });
    }
  });
});

// 3. POST: Guardar nuevo alumno en la Base de Datos (SQL INSERT)
router.post('/', (req, res) => {
  const { rut, nombre, curso, notas, asistencia } = req.body;

  if (!rut || !nombre || !curso) {
    return res.status(400).json({ exito: false, mensaje: 'RUT, Nombre y Curso son obligatorios.' });
  }

  const sql = `INSERT INTO alumnos (rut, nombre, curso, notas, asistencia) VALUES (?, ?, ?, ?, ?)`;
  const params = [rut.trim(), nombre.trim(), curso.trim(), notas || '6.0', asistencia || '100%'];

  db.run(sql, params, function (err) {
    if (err) {
      if (err.message.includes('UNIQUE')) {
        return res.status(400).json({ exito: false, mensaje: 'El RUT ya se encuentra registrado.' });
      }
      return res.status(500).json({ exito: false, mensaje: err.message });
    }

    res.status(201).json({
      exito: true,
      mensaje: '¡Alumno guardado permanentemente en la Base de Datos!',
      id: this.lastID
    });
  });
});

// 4. PUT: Actualizar alumno (SQL UPDATE)
router.put('/rut/:rutBuscado', (req, res) => {
  const rutIngresado = req.params.rutBuscado;
  const { nombre, curso, asistencia } = req.body;

  const sql = `UPDATE alumnos SET nombre = COALESCE(?, nombre), curso = COALESCE(?, curso), asistencia = COALESCE(?, asistencia) WHERE rut = ?`;
  
  db.run(sql, [nombre, curso, asistencia, rutIngresado], function (err) {
    if (err) return res.status(500).json({ exito: false, mensaje: err.message });

    if (this.changes > 0) {
      res.json({ exito: true, mensaje: '¡Datos actualizados permanentemente en SQLite!' });
    } else {
      res.status(404).json({ exito: false, mensaje: 'No se encontró el estudiante para actualizar.' });
    }
  });
});

// 5. DELETE: Eliminar alumno de la Base de Datos (SQL DELETE)
router.delete('/rut/:rutBuscado', (req, res) => {
  const rutIngresado = req.params.rutBuscado;

  db.run("DELETE FROM alumnos WHERE rut = ?", [rutIngresado], function (err) {
    if (err) return res.status(500).json({ exito: false, mensaje: err.message });

    if (this.changes > 0) {
      res.json({ exito: true, mensaje: 'Estudiante borrado permanentemente de la Base de Datos.' });
    } else {
      res.status(404).json({ exito: false, mensaje: 'No se encontró el estudiante para eliminar.' });
    }
  });
});

module.exports = router;