const express = require("express");
const cors = require("cors");
const crypto = require("crypto");

const app = express();
const PORT = process.env.PORT || 3002;
const SECRET = "styleshop-py-2026-secret-key";

app.use(cors());
app.use(express.json());

// ── GENERACIÓN DE KEY ────────────────────────────────────────
function generarKey(negocio, plan, fechaVencimiento) {
  const planCode = plan === "mensual" ? "M" : plan === "anual" ? "A" : "E";
  const fechaCode = fechaVencimiento.replace(/-/g, "");
  const negocioCode = Buffer.from(negocio).toString("base64").replace(/[^A-Z0-9]/gi, "").slice(0, 6).toUpperCase();
  const data = `${negocio}|${planCode}|${fechaCode}`;
  const firma = crypto.createHmac("sha256", SECRET).update(data).digest("hex").slice(0, 8).toUpperCase();
  return `SS-${planCode}${fechaCode}-${negocioCode}-${firma}`;
}

// ── VERIFICACIÓN DE KEY ──────────────────────────────────────
function verificarKey(key) {
  try {
    const k = key.trim().toUpperCase();
    if (!k.startsWith("SS-")) return { valida: false, error: "Formato incorrecto" };
    const parts = k.replace("SS-", "").split("-");
    if (parts.length < 3) return { valida: false, error: "Formato incorrecto" };

    const planFecha = parts[0]; // ej: M20260512
    const planCode = planFecha[0];
    const fechaCode = planFecha.slice(1); // 20260512
    const firma = parts[parts.length - 1];
    const negocioCode = parts.slice(1, parts.length - 1).join("-");

    if (fechaCode.length !== 8) return { valida: false, error: "Fecha inválida" };

    const fechaVencimiento = `${fechaCode.slice(0,4)}-${fechaCode.slice(4,6)}-${fechaCode.slice(6,8)}`;
    const plan = planCode === "M" ? "mensual" : planCode === "A" ? "anual" : "enterprise";

    const hoy = new Date().toISOString().split("T")[0];
    const diasRestantes = Math.round((new Date(fechaVencimiento) - new Date(hoy)) / 86400000);

    return {
      valida: true,
      plan,
      fechaVencimiento,
      diasRestantes,
    };
  } catch {
    return { valida: false, error: "Key inválida" };
  }
}

// ── ENDPOINTS ────────────────────────────────────────────────

// Verificar key (llamado por StyleShop)
app.post("/api/licencias/verificar", (req, res) => {
  const { key } = req.body;
  if (!key) return res.status(400).json({ valida: false, error: "Key requerida" });
  const resultado = verificarKey(key);
  res.json(resultado);
});

// Generar key (llamado por superadmin local)
app.post("/api/licencias/generar", (req, res) => {
  const { negocio, plan, fechaVencimiento } = req.body;
  if (!negocio || !plan || !fechaVencimiento) {
    return res.status(400).json({ error: "Faltan datos" });
  }
  const key = generarKey(negocio, plan, fechaVencimiento);
  res.json({ key, negocio, plan, fechaVencimiento });
});

// Health check
app.get("/", (req, res) => res.json({ status: "ok", servicio: "StyleShop Licencias" }));
app.get("/api/stats", (req, res) => res.json({ status: "ok", servicio: "StyleShop Licencias v1.0" }));

app.listen(PORT, "0.0.0.0", () => {
  console.log(`✅ Servidor de licencias corriendo en puerto ${PORT}`);
});
