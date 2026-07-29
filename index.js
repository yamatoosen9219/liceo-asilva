import express from 'express';
import sqlite3 from 'sqlite3';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;
const JWT_SECRET = process.env.JWT_SECRET || 'clave_secreta_super_segura_liceo_asilva_2025';

app.use(express.json());
app.use(express.static(path.join(__dirname, 'src/publico')));

// ----------------- BASE DE DATOS SQLITE -----------------
const db = new sqlite3.Database('./base_datos.db', (err) => {
  if (err) {
    console.error('Error al conectar a la Base de Datos SQLite:', err.message);
  } else {
    console.log('Conectado exitosamente a la Base de Datos SQLite.');
  }
});

// Helper con Promesas para consultas
const queryDb = (sql, params = []) => {
  return new Promise((resolve, reject) => {
    db.all(sql, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });
};

// Inicialización de Tablas
db.serialize(async () => {
  db.run(`
    CREATE TABLE IF NOT EXISTS usuarios (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      usuario TEXT UNIQUE,
      password TEXT,
      rol TEXT
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS alumnos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      rut TEXT UNIQUE,
      nombre TEXT,
      curso TEXT,
      notas TEXT,
      asistencia TEXT
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS ensayos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      titulo TEXT,
      asignatura TEXT,
      preguntas_json TEXT
    )
  `);

  db.run(`
    CREATE TABLE IF NOT EXISTS resultados_ensayos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ensayo_id INTEGER,
      alumno_rut TEXT,
      puntaje INTEGER,
      total_preguntas INTEGER,
      fecha DATETIME DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Crear usuario admin por defecto si no existe
  db.get('SELECT * FROM usuarios WHERE usuario = ?', ['admin'], async (err, row) => {
    if (!row) {
      const passHash = await bcrypt.hash('admin123', 10);
      db.run('INSERT INTO usuarios (usuario, password, rol) VALUES (?, ?, ?)', ['admin', passHash, 'admin']);
      console.log('Usuario admin inicial creado (admin / admin123)');
    }
  });

  // Crear ensayo de demostración si no hay
  db.get('SELECT COUNT(*) as count FROM ensayos', [], (err, row) => {
    if (row && row.count === 0) {
      const demoPreguntas = JSON.stringify([
        {
          id: 1,
          enunciado: "¿Cuál es el valor de x en la ecuación: 2x + 4 = 10?",
          opciones: ["x = 2", "x = 3", "x = 4", "x = 5"],
          correcta: 1
        },
        {
          id: 2,
          enunciado: "¿Cuál es la capital de Chile?",
          opciones: ["Valparaíso", "Concepción", "Santiago", "La Serena"],
          correcta: 2
        }
      ]);
      db.run(
        'INSERT INTO ensayos (titulo, asignatura, preguntas_json) VALUES (?, ?, ?)',
        ['Ensayo Diagnóstico Inicial PAES', 'General / Diagnóstico', demoPreguntas]
      );
    }
  });
});

// ----------------- MIDDLEWARE AUTENTICACIÓN -----------------
const verificarToken = (req, res, next) => {
  const token = req.headers['authorization']?.split(' ')[1];
  if (!token) return res.status(401).json({ exito: false, mensaje: 'Acceso no autorizado. Token requerido.' });

  jwt.verify(token, JWT_SECRET, (err, decoded) => {
    if (err) return res.status(403).json({ exito: false, mensaje: 'Token inválido o expirado.' });
    req.usuario = decoded;
    next();
  });
};

// ----------------- ENDPOINTS AUTENTICACIÓN & USUARIOS -----------------
app.post('/api/login', async (req, res) => {
  const { usuario, password } = req.body;
  try {
    const usuarios = await queryDb('SELECT * FROM usuarios WHERE usuario = ?', [usuario]);
    if (usuarios.length === 0) return res.status(400).json({ exito: false, mensaje: 'Usuario no encontrado.' });

    const user = usuarios[0];
    const passValido = await bcrypt.compare(password, user.password);
    if (!passValido) return res.status(400).json({ exito: false, mensaje: 'Contraseña incorrecta.' });

    const token = jwt.sign({ id: user.id, usuario: user.usuario, rol: user.rol }, JWT_SECRET, { expiresIn: '8h' });
    res.json({ exito: true, token, usuario: user.usuario, rol: user.rol });
  } catch (err) {
    res.status(500).json({ exito: false, mensaje: 'Error interno en login.' });
  }
});

app.post('/api/usuarios', verificarToken, async (req, res) => {
  if (req.usuario.rol !== 'admin') return res.status(403).json({ exito: false, mensaje: 'Solo administradores.' });
  const { usuario, password, rol } = req.body;
  if (!usuario || !password || !rol) return res.status(400).json({ exito: false, mensaje: 'Faltan campos requeridos.' });

  try {
    const passHash = await bcrypt.hash(password, 10);
    await queryDb('INSERT INTO usuarios (usuario, password, rol) VALUES (?, ?, ?)', [usuario, passHash, rol]);
    res.json({ exito: true, mensaje: `Usuario ${usuario} creado exitosamente.` });
  } catch (err) {
    res.status(400).json({ exito: false, mensaje: 'El nombre de usuario ya existe o hubo un error.' });
  }
});

// ----------------- ENDPOINTS ALUMNOS -----------------
app.get('/api/alumnos', async (req, res) => {
  try {
    const alumnos = await queryDb('SELECT * FROM alumnos ORDER BY id DESC');
    res.json(alumnos);
  } catch (err) {
    res.status(500).json({ exito: false, mensaje: 'Error al obtener alumnos.' });
  }
});

app.get('/api/alumnos/rut/:rut', async (req, res) => {
  try {
    const rutBuscado = req.params.rut.trim();
    const alumnos = await queryDb('SELECT * FROM alumnos WHERE rut = ?', [rutBuscado]);
    if (alumnos.length === 0) return res.status(404).json({ exito: false, mensaje: 'Estudiante no encontrado.' });

    const alumno = alumnos[0];
    let promedioCalculado = "Sin notas";
    if (alumno.notas) {
      const lista = alumno.notas.split(',').map(n => parseFloat(n.trim())).filter(n => !isNaN(n));
      if (lista.length > 0) promedioCalculado = (lista.reduce((a, b) => a + b, 0) / lista.length).toFixed(1);
    }

    // Buscar historial de ensayos rendidos por este alumno
    const historialEnsayos = await queryDb(`
      SELECT r.id, e.titulo, e.asignatura, r.puntaje, r.total_preguntas, r.fecha 
      FROM resultados_ensayos r
      JOIN ensayos e ON r.ensayo_id = e.id
      WHERE r.alumno_rut = ?
      ORDER BY r.fecha DESC
    `, [rutBuscado]);

    const ensayosFormateados = historialEnsayos.map(item => {
      const nota = ((item.puntaje / item.total_preguntas) * 6 + 1).toFixed(1);
      return { ...item, nota };
    });

    res.json({
      exito: true,
      alumno: {
        ...alumno,
        promedioCalculado,
        historialEnsayos: ensayosFormateados
      }
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ exito: false, mensaje: 'Error en consulta de estudiante.' });
  }
});

app.post('/api/alumnos', verificarToken, async (req, res) => {
  const { rut, nombre, curso, notas, asistencia } = req.body;
  if (!rut || !nombre || !curso) return res.status(400).json({ exito: false, mensaje: 'RUT, Nombre y Curso son obligatorios.' });

  try {
    await queryDb(
      'INSERT INTO alumnos (rut, nombre, curso, notas, asistencia) VALUES (?, ?, ?, ?, ?)',
      [rut.trim(), nombre.trim(), curso.trim(), notas || '', asistencia || '100%']
    );
    res.json({ exito: true, mensaje: 'Alumno registrado con éxito.' });
  } catch (err) {
    res.status(400).json({ exito: false, mensaje: 'El RUT ya existe en el sistema.' });
  }
});

app.delete('/api/alumnos/rut/:rut', verificarToken, async (req, res) => {
  try {
    await queryDb('DELETE FROM alumnos WHERE rut = ?', [req.params.rut.trim()]);
    res.json({ exito: true, mensaje: 'Alumno eliminado correctamente.' });
  } catch (err) {
    res.status(500).json({ exito: false, mensaje: 'Error al borrar alumno.' });
  }
});

// ----------------- ENDPOINTS ENSAYOS -----------------
app.get('/api/ensayos', async (req, res) => {
  try {
    const ensayos = await queryDb('SELECT id, titulo, asignatura FROM ensayos ORDER BY id DESC');
    res.json({ exito: true, ensayos });
  } catch (err) {
    res.status(500).json({ exito: false, mensaje: 'Error al listar ensayos.' });
  }
});

app.get('/api/ensayos/:id', async (req, res) => {
  try {
    const ensayos = await queryDb('SELECT * FROM ensayos WHERE id = ?', [req.params.id]);
    if (ensayos.length === 0) return res.status(404).json({ exito: false, mensaje: 'Ensayo no encontrado.' });

    const e = ensayos[0];
    res.json({
      exito: true,
      ensayo: {
        id: e.id,
        titulo: e.titulo,
        asignatura: e.asignatura,
        preguntas: JSON.parse(e.preguntas_json)
      }
    });
  } catch (err) {
    res.status(500).json({ exito: false, mensaje: 'Error al obtener ensayo.' });
  }
});

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

app.post('/api/ensayos/responder', async (req, res) => {
  const { ensayoId, alumnoRut, respuestas } = req.body;
  try {
    const ensayos = await queryDb('SELECT * FROM ensayos WHERE id = ?', [ensayoId]);
    if (ensayos.length === 0) return res.status(404).json({ exito: false, mensaje: 'Ensayo no encontrado.' });

    const preguntas = JSON.parse(ensayos[0].preguntas_json);
    let puntaje = 0;

    preguntas.forEach((p, idx) => {
      if (respuestas[idx] === p.correcta) {
        puntaje++;
      }
    });

    const total = preguntas.length;
    const notaCalculada = ((puntaje / total) * 6 + 1).toFixed(1);

    await queryDb(
      'INSERT INTO resultados_ensayos (ensayo_id, alumno_rut, puntaje, total_preguntas) VALUES (?, ?, ?, ?)',
      [ensayoId, alumnoRut.trim(), puntaje, total]
    );

    res.json({
      exito: true,
      resultado: {
        puntaje,
        total,
        nota: notaCalculada
      }
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ exito: false, mensaje: 'Error al calificar ensayo.' });
  }
});

// ----------------- ESTADÍSTICAS DASHBOARD -----------------
app.get('/api/estadisticas', async (req, res) => {
  try {
    const totalAlumnos = (await queryDb('SELECT COUNT(*) as c FROM alumnos'))[0].c;
    const totalEnsayosRendidos = (await queryDb('SELECT COUNT(*) as c FROM resultados_ensayos'))[0].c;

    const alumnos = await queryDb('SELECT notas FROM alumnos WHERE notas IS NOT NULL AND notas != ""');
    let sumaPromedios = 0;
    let alumnosConNota = 0;

    alumnos.forEach(a => {
      const lista = a.notas.split(',').map(n => parseFloat(n.trim())).filter(n => !isNaN(n));
      if (lista.length > 0) {
        sumaPromedios += lista.reduce((x, y) => x + y, 0) / lista.length;
        alumnosConNota++;
      }
    });

    const promedioGeneral = alumnosConNota > 0 ? (sumaPromedios / alumnosConNota).toFixed(1) : "0.0";

    res.json({
      exito: true,
      totalAlumnos,
      totalEnsayosRendidos,
      promedioGeneral
    });
  } catch (err) {
    res.status(500).json({ exito: false, mensaje: 'Error al calcular estadísticas.' });
  }
});

// Fallback SPA
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'src/publico/index.html'));
});

app.listen(PORT, () => {
  console.log(`Servidor ejecutándose en el puerto ${PORT}`);
});