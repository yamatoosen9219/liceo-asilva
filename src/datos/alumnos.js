// =========================================================
// ARCHIVO: src/datos/alumnos.js
// OBJETIVO: Base de datos temporal de estudiantes del Liceo Asilva
// =========================================================

const alumnos = [
  {
    id: 1,
    rut: "21.456.789-0",
    nombre: "Sofía Morales Asilva",
    curso: "1° Medio A",
    notas: [6.5, 7.0, 6.8, 7.0],
    asistencia: "96%"
  },
  {
    id: 2,
    rut: "22.123.456-7",
    nombre: "Lucas Benítez Gómez",
    curso: "1° Medio A",
    notas: [5.5, 6.0, 5.8, 6.2],
    asistencia: "88%"
  },
  {
    id: 3,
    rut: "21.987.654-3",
    nombre: "Valentina Rojas Silva",
    curso: "2° Medio B",
    notas: [6.0, 6.5, 6.2, 7.0],
    asistencia: "92%"
  }
];

// Exportamos esta lista para que otros archivos de nuestro proyecto puedan usarla
module.exports = alumnos;