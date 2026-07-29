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
      await queryDb(`
        CREATE TABLE IF NOT EXISTS ensayos (
          id SERIAL PRIMARY KEY,
          titulo TEXT NOT NULL,
          asignatura TEXT NOT NULL,
          preguntas_json TEXT NOT NULL
        );
      `);
      await queryDb(`
        CREATE TABLE IF NOT EXISTS resultados_ensayos (
          id SERIAL PRIMARY KEY,
          ensayo_id INTEGER,
          alumno_rut TEXT,
          puntaje REAL,
          total_preguntas INTEGER,
          fecha TIMESTAMP DEFAULT CURRENT_TIMESTAMP
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
      await queryDb(`
        CREATE TABLE IF NOT EXISTS ensayos (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          titulo TEXT NOT NULL,
          asignatura TEXT NOT NULL,
          preguntas_json TEXT NOT NULL
        );
      `);
      await queryDb(`
        CREATE TABLE IF NOT EXISTS resultados_ensayos (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          ensayo_id INTEGER,
          alumno_rut TEXT,
          puntaje REAL,
          total_preguntas INTEGER,
          fecha DATETIME DEFAULT CURRENT_TIMESTAMP
        );
      `);
    }

    // Usuario predeterminado
    const usuarios = await queryDb('SELECT * FROM usuarios WHERE usuario = ?', ['admin']);
    if (usuarios.length === 0) {
      const hash = await bcrypt.hash('admin123', 10);
      await queryDb('INSERT INTO usuarios (usuario, password, rol) VALUES (?, ?, ?)', ['admin', hash, 'admin']);
    }

    // Insertar un ensayo demo si no existe ninguno
    const ensayosExistentes = await queryDb('SELECT * FROM ensayos');
    if (ensayosExistentes.length === 0) {
      const demoPreguntas = JSON.stringify([
        {
          id: 1,
          enunciado: "¿Cuál es el resultado de 3x + 5 = 14?",
          opciones: ["x = 2", "x = 3", "x = 4", "x = 5"],
          correcta: 1 // Índice de "x = 3"
        },
        {
          id: 2,
          enunciado: "¿Cuál es el órgano principal del sistema circulatorio?",
          opciones: ["Pulmón", "Cerebro", "Corazón", "Hígado"],
          correcta: 2 // Índice de "Corazón"
        }
      ]);
      await queryDb('INSERT INTO ensayos (titulo, asignatura, preguntas_json) VALUES (?, ?, ?)', 
        ['Ensayo Diagnóstico Inicial', 'Matemática y Ciencias', demoPreguntas]);
    }

    console.log('✅ Base de datos inicializada correctamente.');
  } catch (err) {
    console.error('❌ Error al inicializar BD:', err);
  }
}

initDB();

// Middlewares
function verificarToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];
  if (!token) return res.status(401).json({ exito: false, mensaje: 'Requiere sesión activa.' });

  jwt.verify(token, JWT_SECRET, (err, usuario) => {
    if (err) return res.status(403).json({ exito: false, mensaje: 'Token inválido.' });
    req.usuario = usuario;
    next();
  });
}

function soloAdmin(req, res, next) {
  if (req.usuario && req.usuario.rol === 'admin') next();
  else res.status(403).json({ exito: false, mensaje: 'Acceso solo para administradores.' });
}

// ---------------- API ENDPOINTS ----------------

// Login
app.post('/api/login', async (req, res) => {
  const { usuario, password } = req.body;
  try {
    const filas = await queryDb('SELECT * FROM usuarios WHERE usuario = ?', [usuario]);
    if (filas.length === 0) return res.status(401).json({ exito: false, mensaje: 'Usuario no existe.' });

    const user = filas[0];
    const ok = await bcrypt.compare(password, user.password);
    if (!ok) return res.status(401).json({ exito: false, mensaje: 'Contraseña incorrecta.' });

    const token = jwt.sign({ id: user.id, usuario: user.usuario, rol: user.rol }, JWT_SECRET, { expiresIn: '8h' });
    res.json({ exito: true, token, usuario: user.usuario, rol: user.rol });
  } catch (err) {
    res.status(500).json({ exito: false, mensaje: 'Error de servidor.' });
  }
});

// Usuarios
app.post('/api/usuarios', verificarToken, soloAdmin, async (req, res) => {
  const { usuario, password, rol } = req.body;
  try {
    const hash = await bcrypt.hash(password, 10);
    await queryDb('INSERT INTO usuarios (usuario, password, rol) VALUES (?, ?, ?)', [usuario.trim(), hash, rol || 'profesor']);
    res.json({ exito: true, mensaje: `Usuario '${usuario}' creado.` });
  } catch (err) {
    res.status(400).json({ exito: false, mensaje: 'El usuario ya existe.' });
  }
});

// Alumnos
app.get('/api/alumnos', async (req, res) => {
  try {
    const alumnos = await queryDb('SELECT * FROM alumnos ORDER BY nombre ASC');
    res.json(alumnos);
  } catch (err) {
    res.status(500).json({ exito: false, mensaje: 'Error al obtener alumnos.' });
  }
});

app.get('/api/alumnos/rut/:rut', async (req, res) => {
  try {
    const alumnos = await queryDb('SELECT * FROM alumnos WHERE rut = ?', [req.params.rut.trim()]);
    if (alumnos.length === 0) return res.status(404).json({ exito: false, mensaje: 'Estudiante no encontrado.' });
    
    const alumno = alumnos[0];
    let promedioCalculado = "Sin notas";
    if (alumno.notas) {
      const lista = alumno.notas.split(',').map(n => parseFloat(n.trim())).filter(n => !isNaN(n));
      if (lista.length > 0) promedioCalculado = (lista.reduce((a, b) => a + b, 0) / lista.length).toFixed(1);
    }
    res.json({ exito: true, alumno: { ...alumno, promedioCalculado } });
  } catch (err) {
    res.status(500).json({ exito: false, mensaje: 'Error en consulta.' });
  }
});

app.post('/api/alumnos', verificarToken, async (req, res) => {
  const { rut, nombre, curso, notas, asistencia } = req.body;
  try {
    await queryDb('INSERT INTO alumnos (rut, nombre, curso, notas, asistencia) VALUES (?, ?, ?, ?, ?)',
      [rut.trim(), nombre.trim(), curso.trim(), notas || '', asistencia || '']);
    res.json({ exito: true, mensaje: 'Estudiante registrado.' });
  } catch (err) {
    res.status(400).json({ exito: false, mensaje: 'El RUT ya existe.' });
  }
});

app.put('/api/alumnos/rut/:rut', verificarToken, async (req, res) => {
  const { nombre, curso, asistencia } = req.body;
  try {
    await queryDb('UPDATE alumnos SET nombre = ?, curso = ?, asistencia = ? WHERE rut = ?',
      [nombre.trim(), curso.trim(), asistencia.trim(), req.params.rut.trim()]);
    res.json({ exito: true, mensaje: 'Alumno actualizado.' });
  } catch (err) {
    res.status(500).json({ exito: false, mensaje: 'Error al actualizar.' });
  }
});

app.delete('/api/alumnos/rut/:rut', verificarToken, soloAdmin, async (req, res) => {
  try {
    await queryDb('DELETE FROM alumnos WHERE rut = ?', [req.params.rut.trim()]);
    res.json({ exito: true, mensaje: 'Estudiante eliminado.' });
  } catch (err) {
    res.status(500).json({ exito: false, mensaje: 'Error al borrar.' });
  }
});

// ----------------- ENSAYOS / EXÁMENES -----------------

// Crear un nuevo ensayo (Solo profesores o admin)
app.post('/api/ensayos', verificarToken, async (req, res) => {
  const { titulo, asignatura, preguntas } = req.body;
  if (!titulo || !asignatura || !preguntas || preguntas.length === 0) {
    return res.status(400).json({ exito: false, mensaje: 'Faltan datos o preguntas en el ensayo.' });
  }

  try {
    const preguntasJson = JSON.stringify(preguntas);
    await queryDb(
      'INSERT INTO ensayos (titulo, asignatura, preguntas_json) VALUES (?, ?, ?)',
      [titulo.trim(), asignatura.trim(), preguntasJson]
    );
    res.json({ exito: true, mensaje: '¡Ensayo creado e incorporado al banco exitosamente!' });
  } catch (err) {
    console.error('Error al crear ensayo:', err);
    res.status(500).json({ exito: false, mensaje: 'Error al guardar el ensayo.' });
  }
});

// Guardar resultado de ensayo rendido por un estudiante
app.post('/api/ensayos/responder', async (req, res) => {
  const { ensayoId, alumnoRut, respuestas } = req.body; // respuestas = [0, 2, 1...] (índices marcados)
  try {
    const filas = await queryDb('SELECT preguntas_json FROM ensayos WHERE id = ?', [ensayoId]);
    if (filas.length === 0) return res.status(404).json({ exito: false, mensaje: 'Ensayo no válido.' });

    const preguntas = JSON.parse(filas[0].preguntas_json);
    let correctas = 0;

    preguntas.forEach((p, idx) => {
      if (respuestas[idx] !== undefined && respuestas[idx] === p.correcta) {
        correctas++;
      }
    });

    const notaEscala = ((correctas / preguntas.length) * 6 + 1).toFixed(1); // Nota de 1.0 a 7.0

    await queryDb(
      'INSERT INTO resultados_ensayos (ensayo_id, alumno_rut, puntaje, total_preguntas) VALUES (?, ?, ?, ?)',
      [ensayoId, alumnoRut.trim(), correctas, preguntas.length]
    );

    res.json({
      exito: true,
      mensaje: 'Ensayo completado exitosamente.',
      resultado: {
        correctas,
        total: preguntas.length,
        nota: notaEscala
      }
    });
  } catch (err) {
    res.status(500).json({ exito: false, mensaje: 'Error al guardar respuesta.' });
  }
});

// Obtener estadísticas acumuladas para los gráficos
app.get('/api/estadisticas', async (req, res) => {
  try {
    const alumnos = await queryDb('SELECT * FROM alumnos');
    const resultados = await queryDb('SELECT * FROM resultados_ensayos');

    // Promedio de notas general
    let sumaNotas = 0;
    let totalNotas = 0;
    alumnos.forEach(a => {
      if (a.notas) {
        const arr = a.notas.split(',').map(n => parseFloat(n.trim())).filter(n => !isNaN(n));
        arr.forEach(n => { sumaNotas += n; totalNotas++; });
      }
    });

    const promedioGeneral = totalNotas > 0 ? (sumaNotas / totalNotas).toFixed(1) : "0.0";

    res.json({
      exito: true,
      totalAlumnos: alumnos.length,
      promedioGeneral,
      totalEnsayosRendidos: resultados.length,
      ultimosResultados: resultados.slice(-10)
    });
  } catch (err) {
    res.status(500).json({ exito: false, mensaje: 'Error al obtener métricas.' });
  }
});

app.listen(PORT, () => console.log(`🚀 Servidor corriendo en puerto ${PORT}`));