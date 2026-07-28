// =========================================================
// ARCHIVO: src/datos/bd.js
// OBJETIVO: Configurar y conectar la Base de Datos SQLite
// =========================================================

const sqlite3 = require('sqlite3').verbose();
const path = require('path');

// Definimos la ubicación del archivo de la base de datos (.db)
const rutaBD = path.join(__dirname, '../../colegio.db');

// Conectamos (si el archivo colegio.db no existe, SQLite lo crea automáticamente)
const db = new sqlite3.Database(rutaBD, (err) => {
  if (err) {
    console.error('❌ Error al conectar a SQLite:', err.message);
  } else {
    console.log('📦 Conectado exitosamente a la base de datos SQLite (colegio.db)');
  }
});

// Crear la tabla "alumnos" si no existe e insertar datos iniciales
db.serialize(() => {
  db.run(`
    CREATE TABLE IF NOT EXISTS alumnos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      rut TEXT UNIQUE NOT NULL,
      nombre TEXT NOT NULL,
      curso TEXT NOT NULL,
      notas TEXT,
      asistencia TEXT
    )
  `);

  // Insertamos a Sofía Morales de prueba si la tabla está totalmente vacía
  db.get("SELECT COUNT(*) as total FROM alumnos", (err, row) => {
    if (row && row.total === 0) {
      db.run(`
        INSERT INTO alumnos (rut, nombre, curso, notas, asistencia) 
        VALUES ('21.456.789-0', 'Sofía Morales Asilva', '1° Medio A', '6.5, 7.0, 6.8, 7.0', '96%')
      `);
      console.log('🌱 Datos de prueba iniciales insertados en la Base de Datos.');
    }
  });
});

module.exports = db;