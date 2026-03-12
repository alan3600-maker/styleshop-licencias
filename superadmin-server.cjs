const express = require("express");
const Database = require("better-sqlite3");
const cors = require("cors");
const path = require("path");
const crypto = require("crypto");

// ── LICENCIAS ────────────────────────────────────────────────
// Clave secreta para firmar las keys (no cambiar después de generar keys)
const SECRET = "styleshop-py-2026-secret-key";

function generarKey(negocio, plan, fechaVencimiento) {
  // Formato simple: SS-[PLAN]-[FECHA]-[FIRMA]
  const planCode = plan === "mensual" ? "M" : plan === "anual" ? "A" : "E";
  const fechaCode = fechaVencimiento.replace(/-/g, ""); // 20260512
  const data = `${negocio}|${planCode}|${fechaCode}`;
  const firma = crypto.createHmac("sha256", SECRET).update(data).digest("hex").slice(0, 8).toUpperCase();
  return `SS-${planCode}${fechaCode}-${firma}`;
}

function verificarKey(key) {
  try {
    if (!key.startsWith("SS-")) return { valida: false, error: "Formato incorrecto" };
    const parts = key.replace("SS-", "").split("-");
    if (parts.length < 2) return { valida: false, error: "Formato incorrecto" };
    // buscar directamente en la BD — la key es la fuente de verdad
    return { valida: true };
  } catch {
    return { valida: false, error: "Formato incorrecto" };
  }
}

const app = express();
const PORT = process.env.PORT || 3002;
app.use(cors());
app.use(express.json());

const db = new Database(path.join(__dirname, "superadmin.db"));

db.exec(`
  CREATE TABLE IF NOT EXISTS clientes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    negocio TEXT NOT NULL,
    contacto TEXT NOT NULL,
    telefono TEXT,
    email TEXT,
    ciudad TEXT,
    plan TEXT NOT NULL DEFAULT 'mensual',
    estado TEXT NOT NULL DEFAULT 'trial',
    fechaInicio TEXT NOT NULL,
    fechaVencimiento TEXT NOT NULL,
    precioMensual REAL DEFAULT 250000,
    precioTotal REAL DEFAULT 250000,
    notasEnterprise TEXT,
    notas TEXT,
    creadoEn TEXT DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS pagos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    clienteId INTEGER NOT NULL,
    fecha TEXT NOT NULL,
    monto REAL NOT NULL,
    metodo TEXT DEFAULT 'Transferencia',
    periodo TEXT,
    comprobante TEXT,
    notas TEXT,
    creadoEn TEXT DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS renovaciones (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    clienteId INTEGER NOT NULL,
    fechaAnterior TEXT,
    fechaNueva TEXT,
    plan TEXT,
    monto REAL,
    fecha TEXT
  );
`);

// tabla de keys generadas
db.exec(`
  CREATE TABLE IF NOT EXISTS licencias (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    clienteId INTEGER NOT NULL,
    key TEXT NOT NULL UNIQUE,
    negocio TEXT NOT NULL,
    plan TEXT NOT NULL,
    fechaVencimiento TEXT NOT NULL,
    activa INTEGER DEFAULT 1,
    generadaEn TEXT DEFAULT CURRENT_TIMESTAMP
  );
`);

// ── LICENCIAS ────────────────────────────────────────────────
app.post("/api/licencias/generar", (req, res) => {
  const { clienteId } = req.body;
  const cliente = db.prepare("SELECT * FROM clientes WHERE id=?").get(clienteId);
  if (!cliente) return res.status(404).json({ error: "Cliente no encontrado" });
  // desactivar keys anteriores del cliente
  db.prepare("UPDATE licencias SET activa=0 WHERE clienteId=?").run(clienteId);
  const key = generarKey(cliente.negocio, cliente.plan, cliente.fechaVencimiento);
  db.prepare("INSERT INTO licencias (clienteId,key,negocio,plan,fechaVencimiento) VALUES (?,?,?,?,?)").run(clienteId, key, cliente.negocio, cliente.plan, cliente.fechaVencimiento);
  res.json({ key, negocio: cliente.negocio, plan: cliente.plan, fechaVencimiento: cliente.fechaVencimiento });
});

app.get("/api/licencias/cliente/:id", (req, res) => {
  const keys = db.prepare("SELECT * FROM licencias WHERE clienteId=? ORDER BY id DESC").all(req.params.id);
  res.json(keys);
});

// endpoint público que llama StyleShop para verificar
app.post("/api/licencias/verificar", (req, res) => {
  const { key } = req.body;
  if (!key) return res.status(400).json({ valida: false, error: "Key requerida" });
  const keyLimpia = key.trim().toUpperCase();
  const lic = db.prepare("SELECT * FROM licencias WHERE key=? AND activa=1").get(keyLimpia);
  if (!lic) return res.json({ valida: false, error: "Key no registrada o desactivada" });
  const hoy = new Date().toISOString().split("T")[0];
  const diasRestantes = Math.round((new Date(lic.fechaVencimiento) - new Date(hoy)) / 86400000);
  res.json({ valida: true, negocio: lic.negocio, plan: lic.plan, fechaVencimiento: lic.fechaVencimiento, diasRestantes });
});

// seed inicial
const cnt = db.prepare("SELECT COUNT(*) as c FROM clientes").get();
if (cnt.c === 0) {
  const ins = db.prepare("INSERT INTO clientes (negocio,contacto,telefono,email,ciudad,plan,estado,fechaInicio,fechaVencimiento,precioMensual,precioTotal) VALUES (?,?,?,?,?,?,?,?,?,?,?)");
  const hoy = new Date();
  const addD = (d) => { const f = new Date(hoy); f.setDate(f.getDate() + d); return f.toISOString().split("T")[0]; };
  ins.run("Boutique Rosa","María González","0981-123456","maria@boutique.com","Asunción","mensual","activa", addD(-30), addD(0), 250000, 250000);
  ins.run("Moda Express","Carlos Ruiz","0991-234567","carlos@modaexpress.com","CDE","anual","activa", addD(-60), addD(305), 250000, 2500000);
  ins.run("Fashion Store","Ana López","0982-345678","ana@fashion.com","Encarnación","mensual","trial", addD(-7), addD(7), 250000, 250000);
  ins.run("Calzados Don Pedro","Pedro Martínez","0971-456789","pedro@calzados.com","Luque","enterprise","activa", addD(-90), addD(275), 0, 0);
  ins.run("Tienda Nueva","Roberto Silva","0961-567890","roberto@tienda.com","Lambaré","mensual","vencida", addD(-45), addD(-15), 250000, 250000);
}

// ── CLIENTES ────────────────────────────────────────────────
app.get("/api/clientes", (req, res) => {
  const clientes = db.prepare("SELECT * FROM clientes ORDER BY id DESC").all();
  const pagos = db.prepare("SELECT * FROM pagos ORDER BY id DESC").all();
  res.json(clientes.map(c => ({ ...c, pagos: pagos.filter(p => p.clienteId === c.id) })));
});

app.post("/api/clientes", (req, res) => {
  const { negocio, contacto, telefono, email, ciudad, plan, fechaInicio, precioMensual, notasEnterprise, notas } = req.body;
  // calcular vencimiento y precio según plan
  const inicio = new Date(fechaInicio);
  let fechaVenc, precioTotal;
  if (plan === "mensual") {
    const f = new Date(inicio); f.setMonth(f.getMonth() + 1);
    fechaVenc = f.toISOString().split("T")[0];
    precioTotal = +precioMensual;
  } else if (plan === "anual") {
    const f = new Date(inicio); f.setMonth(f.getMonth() + 14); // 12 + 2 gratis
    fechaVenc = f.toISOString().split("T")[0];
    precioTotal = +precioMensual * 12;
  } else {
    const f = new Date(inicio); f.setFullYear(f.getFullYear() + 1);
    fechaVenc = f.toISOString().split("T")[0];
    precioTotal = 0;
  }
  const r = db.prepare("INSERT INTO clientes (negocio,contacto,telefono,email,ciudad,plan,estado,fechaInicio,fechaVencimiento,precioMensual,precioTotal,notasEnterprise,notas) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)").run(negocio, contacto, telefono, email, ciudad, plan, "trial", fechaInicio, fechaVenc, +precioMensual || 250000, precioTotal, notasEnterprise || "", notas || "");
  res.json({ id: r.lastInsertRowid, fechaVencimiento: fechaVenc, precioTotal });
});

app.put("/api/clientes/:id", (req, res) => {
  const { negocio, contacto, telefono, email, ciudad, plan, estado, fechaVencimiento, precioMensual, precioTotal, notasEnterprise, notas } = req.body;
  db.prepare("UPDATE clientes SET negocio=?,contacto=?,telefono=?,email=?,ciudad=?,plan=?,estado=?,fechaVencimiento=?,precioMensual=?,precioTotal=?,notasEnterprise=?,notas=? WHERE id=?").run(negocio, contacto, telefono, email, ciudad, plan, estado, fechaVencimiento, precioMensual, precioTotal, notasEnterprise || "", notas || "", req.params.id);
  res.json({ success: true });
});

app.delete("/api/clientes/:id", (req, res) => {
  db.prepare("DELETE FROM clientes WHERE id=?").run(req.params.id);
  db.prepare("DELETE FROM pagos WHERE clienteId=?").run(req.params.id);
  res.json({ success: true });
});

// ── PAGOS ────────────────────────────────────────────────────
app.post("/api/pagos", (req, res) => {
  const { clienteId, fecha, monto, metodo, periodo, comprobante, notas, renovar } = req.body;
  const r = db.prepare("INSERT INTO pagos (clienteId,fecha,monto,metodo,periodo,comprobante,notas) VALUES (?,?,?,?,?,?,?)").run(clienteId, fecha, monto, metodo, periodo || "", comprobante || "", notas || "");

  if (renovar) {
    const cliente = db.prepare("SELECT * FROM clientes WHERE id=?").get(clienteId);
    const base = new Date(cliente.fechaVencimiento) > new Date() ? new Date(cliente.fechaVencimiento) : new Date();
    let nuevaFecha;
    if (cliente.plan === "mensual") { base.setMonth(base.getMonth() + 1); nuevaFecha = base.toISOString().split("T")[0]; }
    else if (cliente.plan === "anual") { base.setMonth(base.getMonth() + 14); nuevaFecha = base.toISOString().split("T")[0]; }
    else { base.setFullYear(base.getFullYear() + 1); nuevaFecha = base.toISOString().split("T")[0]; }
    db.prepare("UPDATE clientes SET estado='activa', fechaVencimiento=? WHERE id=?").run(nuevaFecha, clienteId);
    db.prepare("INSERT INTO renovaciones (clienteId,fechaAnterior,fechaNueva,plan,monto,fecha) VALUES (?,?,?,?,?,?)").run(clienteId, cliente.fechaVencimiento, nuevaFecha, cliente.plan, monto, fecha);
    res.json({ id: r.lastInsertRowid, nuevaFecha });
  } else {
    res.json({ id: r.lastInsertRowid });
  }
});

app.delete("/api/pagos/:id", (req, res) => {
  db.prepare("DELETE FROM pagos WHERE id=?").run(req.params.id);
  res.json({ success: true });
});

// ── DASHBOARD STATS ──────────────────────────────────────────
app.get("/api/stats", (req, res) => {
  const hoy = new Date().toISOString().split("T")[0];
  const mes = hoy.slice(0, 7);
  const en15 = new Date(Date.now() + 15 * 86400000).toISOString().split("T")[0];

  const clientes = db.prepare("SELECT * FROM clientes").all();
  const pagos = db.prepare("SELECT * FROM pagos").all();

  const activos = clientes.filter(c => c.estado === "activa").length;
  const trials = clientes.filter(c => c.estado === "trial").length;
  const vencidos = clientes.filter(c => c.estado === "vencida").length;
  const porVencer = clientes.filter(c => c.estado === "activa" && c.fechaVencimiento <= en15 && c.fechaVencimiento >= hoy);

  const pagosMes = pagos.filter(p => p.fecha.startsWith(mes));
  const mrr = pagosMes.reduce((s, p) => s + p.monto, 0);
  const totalHistorico = pagos.reduce((s, p) => s + p.monto, 0);

  // MRR proyectado (clientes activos × su precio mensual)
  const mrrProyectado = clientes.filter(c => c.estado === "activa" && c.plan === "mensual").reduce((s, c) => s + c.precioMensual, 0)
    + clientes.filter(c => c.estado === "activa" && c.plan === "anual").reduce((s, c) => s + (c.precioTotal / 12), 0);

  res.json({ activos, trials, vencidos, total: clientes.length, porVencer, mrr, mrrProyectado, totalHistorico });
});

app.listen(PORT, "0.0.0.0", () => {
  console.log(`✅ Super Admin corriendo en http://localhost:${PORT}`);
  console.log(`📊 Panel: abrir superadmin.html en el navegador`);
});
