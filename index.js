const express = require('express');
const { Pool } = require('pg');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'secreto_super_seguro_liceo_asilva_2026';

app.use(cors());
app.use(express.json());
app.use(express.static(path.join(__dirname, 'src', 'publico')));

// Base de Datos (PostgreSQL / SQLite)
const isPostgres = !!process.env.DATABASE_URL;
let dbPg = null;
let dbSqlite = null;

if (isPostgres) {
  console.log('🔗 Conectando a PostgreSQL en la nube...');
  dbPg = new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: { rejectUnauthorized: false }
  });
} else {
  console.log('📁 Conectando a SQLite local...');
  const dbPath = path.join(__dirname, 'colegio.db');
  dbSqlite = new sqlite3.Database(dbPath);
}

async function queryDb(sql, params = []) {
  if (isPostgres) {
    let paramIndex = 1;
    const pgSql = sql.replace(/\?/g, () => `$${paramIndex++}`);
    const res = await dbPg.query(pgSql, params);
    return res.rows;
  } else {
    return new Promise((resolve, reject) => {
      const isSelect = sql.trim().toUpperCase().startsWith('SELECT');
      if (isSelect) {
        dbSqlite.all(sql, params, (err, rows) => {
          if (err) reject(err);
          else resolve(rows);
        });
      } else {
        dbSqlite.run(sql, params, function (err) {
          if (err) reject(err);
          else resolve({ lastID: this.lastID, changes: this.changes });
        });
      }
    });
  }
}

async function initDB() {
  try {
    if (isPostgres) {
      await queryDb(`
        CREATE TABLE IF NOT EXISTS usuarios (
          id SERIAL PRIMARY KEY,
          usuario TEXT UNIQUE NOT NULL,
          password TEXT NOT NULL,
          rol TEXT DEFAULT 'admin'
        );
      `);
      await queryDb(`
        CREATE TABLE IF NOT EXISTS alumnos (
          id SERIAL PRIMARY KEY,
          rut TEXT UNIQUE NOT NULL,
          nombre TEXT NOT NULL,
          curso TEXT NOT NULL,
          notas TEXT,
          asistencia TEXT
        );
      `);
    } else {
      await queryDb(`
        CREATE TABLE IF NOT EXISTS usuarios (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          usuario TEXT UNIQUE NOT NULL,
          password TEXT NOT NULL,
          rol TEXT DEFAULT 'admin'
        );
      `);
      await queryDb(`
        CREATE TABLE IF NOT EXISTS alumnos (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          rut TEXT UNIQUE NOT NULL,
          nombre TEXT NOT NULL,
          curso TEXT NOT NULL,
          notas TEXT,
          asistencia TEXT
        );
      `);
    }

    const usuarios = await queryDb('SELECT * FROM usuarios WHERE usuario = ?', ['admin']);
    if (usuarios.length === 0) {
      const hash = await bcrypt.hash('admin123', 10);
      await queryDb('INSERT INTO usuarios (usuario, password, rol) VALUES (?, ?, ?)', ['admin', hash, 'admin']);
      console.log('👤 Usuario admin predeterminado listo (Contraseña: admin123)');
    }
    console.log('✅ Base de datos inicializada correctamente.');
  } catch (err) {
    console.error('❌ Error al inicializar BD:', err);
  }
}

initDB();

// Middleware de Autenticación
function verificarToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) {
    return res.status(401).json({ exito: false, mensaje: 'Acceso denegado. Requiere iniciar sesión.' });
  }

  jwt.verify(token, JWT_SECRET, (err, usuario) => {
    if (err) {
      return res.status(403).json({ exito: false, mensaje: 'Token inválido o expirado.' });
    }
    req.usuario = usuario;
    next();
  });
}

// Middleware Solo Admin
function soloAdmin(req, res, next) {
  if (req.usuario && req.usuario.rol === 'admin') {
    next();
  } else {
    res.status(403).json({ exito: false, mensaje: 'Acceso restringido. Requiere rol de Administrador.' });
  }
}

// ----------------------------------------------------
// RUTAS DE LA API
// ----------------------------------------------------

// Login
app.post('/api/login', async (req, res) => {
  const { usuario, password } = req.body;
  if (!usuario || !password) {
    return res.status(400).json({ exito: false, mensaje: 'Ingrese usuario y contraseña.' });
  }

  try {
    const filas = await queryDb('SELECT * FROM usuarios WHERE usuario = ?', [usuario]);
    if (filas.length === 0) {
      return res.status(401).json({ exito: false, mensaje: 'Usuario o contraseña incorrectos.' });
    }

    const user = filas[0];
    const passwordValida = await bcrypt.compare(password, user.password);
    if (!passwordValida) {
      return res.status(401).json({ exito: false, mensaje: 'Usuario o contraseña incorrectos.' });
    }

    const token = jwt.sign(
      { id: user.id, usuario: user.usuario, rol: user.rol || 'admin' },
      JWT_SECRET,
      { expiresIn: '8h' }
    );

    res.json({
      exito: true,
      mensaje: 'Autenticación exitosa',
      token,
      usuario: user.usuario,
      rol: user.rol || 'admin'
    });
  } catch (err) {
    res.status(500).json({ exito: false, mensaje: 'Error interno en el servidor.' });
  }
});

// Crear nuevo usuario (Solo Admin)
app.post('/api/usuarios', verificarToken, soloAdmin, async (req, res) => {
  const { usuario, password, rol } = req.body;
  if (!usuario || !password) {
    return res.status(400).json({ exito: false, mensaje: 'Usuario y contraseña son requeridos.' });
  }

  try {
    const hash = await bcrypt.hash(password, 10);
    const rolUsuario = rol || 'profesor';
    await queryDb('INSERT INTO usuarios (usuario, password, rol) VALUES (?, ?, ?)', [usuario.trim(), hash, rolUsuario]);
    res.json({ exito: true, mensaje: `Usuario '${usuario}' creado exitosamente con rol '${rolUsuario}'.` });
  } catch (err) {
    res.status(400).json({ exito: false, mensaje: 'Error: El nombre de usuario ya existe.' });
  }
});

// Obtener lista de usuarios (Solo Admin)
app.get('/api/usuarios', verificarToken, soloAdmin, async (req, res) => {
  try {
    const usuarios = await queryDb('SELECT id, usuario, rol FROM usuarios ORDER BY id ASC');
    res.json({ exito: true, usuarios });
  } catch (err) {
    res.status(500).json({ exito: false, mensaje: 'Error al consultar usuarios.' });
  }
});

// Obtener todos los alumnos
app.get('/api/alumnos', async (req, res) => {
  try {
    const alumnos = await queryDb('SELECT * FROM alumnos ORDER BY nombre ASC');
    res.json(alumnos);
  } catch (err) {
    res.status(500).json({ exito: false, mensaje: 'Error al consultar alumnos.' });
  }
});

// Buscar alumno por RUT
app.get('/api/alumnos/rut/:rut', async (req, res) => {
  const rutBuscado = req.params.rut.trim();
  try {
    const alumnos = await queryDb('SELECT * FROM alumnos WHERE rut = ?', [rutBuscado]);
    if (alumnos.length === 0) {
      return res.status(404).json({ exito: false, mensaje: 'Estudiante no encontrado.' });
    }

    const alumno = alumnos[0];
    let promedioCalculado = "Sin notas";

    if (alumno.notas) {
      const listaNotas = alumno.notas.split(',').map(n => parseFloat(n.trim())).filter(n => !isNaN(n));
      if (listaNotas.length > 0) {
        const suma = listaNotas.reduce((acc, val) => acc + val, 0);
        promedioCalculado = (suma / listaNotas.length).toFixed(1);
      }
    }

    res.json({ exito: true, alumno: { ...alumno, promedioCalculado } });
  } catch (err) {
    res.status(500).json({ exito: false, mensaje: 'Error al buscar estudiante.' });
  }
});

// Registrar nuevo alumno (Profesor o Admin)
app.post('/api/alumnos', verificarToken, async (req, res) => {
  const { rut, nombre, curso, notas, asistencia } = req.body;
  if (!rut || !nombre || !curso) {
    return res.status(400).json({ exito: false, mensaje: 'RUT, Nombre y Curso son obligatorios.' });
  }

  try {
    await queryDb(
      'INSERT INTO alumnos (rut, nombre, curso, notas, asistencia) VALUES (?, ?, ?, ?, ?)',
      [rut.trim(), nombre.trim(), curso.trim(), notas || '', asistencia || '']
    );
    res.json({ exito: true, mensaje: 'Estudiante registrado con éxito.' });
  } catch (err) {
    res.status(400).json({ exito: false, mensaje: 'Error al registrar: El RUT ya existe.' });
  }
});

// Editar alumno por RUT (Profesor o Admin)
app.put('/api/alumnos/rut/:rut', verificarToken, async (req, res) => {
  const rutBuscado = req.params.rut.trim();
  const { nombre, curso, asistencia } = req.body;

  try {
    await queryDb(
      'UPDATE alumnos SET nombre = ?, curso = ?, asistencia = ? WHERE rut = ?',
      [nombre.trim(), curso.trim(), asistencia.trim(), rutBuscado]
    );
    res.json({ exito: true, mensaje: 'Datos del estudiante actualizados correctamente.' });
  } catch (err) {
    res.status(500).json({ exito: false, mensaje: 'Error al actualizar estudiante.' });
  }
});

// Eliminar alumno por RUT (Solo Admin)
app.delete('/api/alumnos/rut/:rut', verificarToken, soloAdmin, async (req, res) => {
  const rutBuscado = req.params.rut.trim();
  try {
    await queryDb('DELETE FROM alumnos WHERE rut = ?', [rutBuscado]);
    res.json({ exito: true, mensaje: 'Estudiante eliminado del sistema.' });
  } catch (err) {
    res.status(500).json({ exito: false, mensaje: 'Error al eliminar estudiante.' });
  }
});

app.listen(PORT, () => {
  console.log(`🚀 Servidor listo en puerto ${PORT}`);
});