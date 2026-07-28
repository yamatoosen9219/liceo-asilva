const express = require('express');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const bcrypt = require('bcryptjs'); // <--- PASO 1/2: Importar bcryptjs
const jwt = require('jsonwebtoken'); // <--- PASO 1/2: Importar jsonwebtoken

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = 'clave_secreta_liceo_asilva_2026'; // Clave para la firma de tokens

// Middleware para procesar JSON y archivos estáticos
app.use(express.json());
app.use(express.static(path.join(__dirname, 'src', 'publico')));

// Conexión a la Base de Datos SQLite
const db = new sqlite3.Database('./colegio.db', (err) => {
  if (err) {
    console.error('Error al conectar con la base de datos:', err.message);
  } else {
    console.log('📦 Conectado exitosamente a la base de datos SQLite (colegio.db)');
  }
});

// =========================================================
// PASO 2: CREACIÓN DE TABLAS Y USUARIO ADMIN INICIAL
// =========================================================
db.serialize(() => {
  // 1. Tabla de Alumnos
  db.run(`CREATE TABLE IF NOT EXISTS alumnos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    rut TEXT UNIQUE,
    nombre TEXT,
    curso TEXT,
    notas TEXT,
    asistencia TEXT
  )`);

  // 2. Tabla de Usuarios para el Login
  db.run(`CREATE TABLE IF NOT EXISTS usuarios (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    usuario TEXT UNIQUE,
    password TEXT,
    rol TEXT
  )`, async () => {
    // Verificar si existe el usuario 'admin' para no duplicarlo
    db.get(`SELECT * FROM usuarios WHERE usuario = ?`, ['admin'], async (err, row) => {
      if (!row) {
        const adminPass = await bcrypt.hash('admin123', 10);
        db.run(`INSERT INTO usuarios (usuario, password, rol) VALUES (?, ?, ?)`,
          ['admin', adminPass, 'Administrador'],
          (err) => {
            if (!err) console.log('👤 Usuario admin por defecto creado (admin / admin123)');
          }
        );
      }
    });
  });
});

// =========================================================
// PASO 3: MIDDLEWARE DE AUTENTICACIÓN Y RUTAS DE ACCESO
// =========================================================

// Middleware para verificar que la petición tenga un Token válido
function verificarToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1]; // "Bearer <TOKEN>"

  if (!token) {
    return res.status(403).json({ exito: false, mensaje: 'Acceso denegado: Inicie sesión para continuar' });
  }

  jwt.verify(token, JWT_SECRET, (err, decoded) => {
    if (err) {
      return res.status(401).json({ exito: false, mensaje: 'Sesión expirada o token inválido' });
    }
    req.usuario = decoded;
    next();
  });
}

// Ruta POST: Iniciar Sesión (Login)
app.post('/api/login', (req, res) => {
  const { usuario, password } = req.body;

  db.get(`SELECT * FROM usuarios WHERE usuario = ?`, [usuario], async (err, user) => {
    if (err || !user) {
      return res.status(401).json({ exito: false, mensaje: 'Usuario o contraseña incorrectos' });
    }

    const passwordValida = await bcrypt.compare(password, user.password);
    if (!passwordValida) {
      return res.status(401).json({ exito: false, mensaje: 'Usuario o contraseña incorrectos' });
    }

    // Generar Token firmado válido por 2 horas
    const token = jwt.sign(
      { id: user.id, usuario: user.usuario, rol: user.rol },
      JWT_SECRET,
      { expiresIn: '2h' }
    );

    res.json({ exito: true, mensaje: 'Acceso concedido', token, usuario: user.usuario });
  });
});

// =========================================================
// RUTAS DE LA API REST (ALUMNOS)
// =========================================================

// GET: Obtener todos los alumnos
app.get('/api/alumnos', (req, res) => {
  db.all('SELECT * FROM alumnos', [], (err, filas) => {
    if (err) {
      res.status(500).json({ exito: false, mensaje: err.message });
    } else {
      res.json({ exito: true, datos: filas });
    }
  });
});

// GET: Buscar por RUT
app.get('/api/alumnos/rut/:rut', (req, res) => {
  const rutBusqueda = req.params.rut;
  db.get('SELECT * FROM alumnos WHERE rut = ?', [rutBusqueda], (err, alumno) => {
    if (err) {
      res.status(500).json({ exito: false, mensaje: err.message });
    } else if (!alumno) {
      res.status(404).json({ exito: false, mensaje: 'Estudiante no encontrado' });
    } else {
      // Calcular promedio rápido
      let promedio = 'N/A';
      if (alumno.notas) {
        const arrNotas = alumno.notas.split(',').map(n => parseFloat(n.trim())).filter(n => !isNaN(n));
        if (arrNotas.length > 0) {
          promedio = (arrNotas.reduce((a, b) => a + b, 0) / arrNotas.length).toFixed(1);
        }
      }
      alumno.promedioCalculado = promedio;
      res.json({ exito: true, alumno });
    }
  });
});

// POST: Registrar alumno (Protegido con token)
app.post('/api/alumnos', verificarToken, (req, res) => {
  const { rut, nombre, curso, notas, asistencia } = req.body;
  const sql = `INSERT INTO alumnos (rut, nombre, curso, notas, asistencia) VALUES (?, ?, ?, ?, ?)`;
  
  db.run(sql, [rut, nombre, curso, notas, asistencia], function (err) {
    if (err) {
      res.status(400).json({ exito: false, mensaje: 'El RUT ya se encuentra registrado' });
    } else {
      res.json({ exito: true, mensaje: 'Estudiante registrado con éxito', id: this.lastID });
    }
  });
});

// PUT: Actualizar alumno (Protegido con token)
app.put('/api/alumnos/rut/:rut', verificarToken, (req, res) => {
  const rutTarget = req.params.rut;
  const { nombre, curso, asistencia } = req.body;
  const sql = `UPDATE alumnos SET nombre = ?, curso = ?, asistencia = ? WHERE rut = ?`;

  db.run(sql, [nombre, curso, asistencia, rutTarget], function (err) {
    if (err) {
      res.status(500).json({ exito: false, mensaje: err.message });
    } else {
      res.json({ exito: true, mensaje: 'Datos del estudiante actualizados con éxito' });
    }
  });
});

// DELETE: Eliminar alumno (Protegido con token)
app.delete('/api/alumnos/rut/:rut', verificarToken, (req, res) => {
  const rutTarget = req.params.rut;
  db.run(`DELETE FROM alumnos WHERE rut = ?`, [rutTarget], function (err) {
    if (err) {
      res.status(500).json({ exito: false, mensaje: err.message });
    } else {
      res.json({ exito: true, mensaje: 'Estudiante eliminado con éxito' });
    }
  });
});

// Iniciar Servidor
app.listen(PORT, () => {
  console.log(`📌 Sistema del Liceo Asilva disponible en: http://localhost:${PORT}`);
});