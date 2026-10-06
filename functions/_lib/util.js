// ========================================
// UTILIDADES COMPARTIDAS DEL SERVIDOR
// ========================================
//
// Este archivo NO es una ruta: vive en functions/_lib y solo
// lo importan las funciones reales de functions/api/.

const encoder = new TextEncoder();

// ----------------------------------------
// Respuestas
// ----------------------------------------

export function json(datos, status = 200, extra = {}) {
    return new Response(JSON.stringify(datos), {
        status,
        headers: {
            "Content-Type": "application/json; charset=utf-8",
            "Cache-Control": "no-store",
            ...extra
        }
    });
}

export function error(mensaje, status = 400) {
    return json({ error: mensaje }, status);
}

// ----------------------------------------
// Sesión: cookie firmada con HMAC-SHA256
// ----------------------------------------
//
// Valor de la cookie: <idUsuario>.<expiraEnSegundos>.<firma>
// La firma usa SESSION_SECRET, así que nadie puede fabricar
// una cookie válida sin conocerlo.

export const NOMBRE_COOKIE = "leda_sesion";
const DURACION_SESION_SEG = 60 * 60 * 24 * 30;

function aBase64Url(bytes) {
    let texto = "";
    bytes.forEach((b) => { texto += String.fromCharCode(b); });
    return btoa(texto).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function firmar(texto, secreto) {
    const clave = await crypto.subtle.importKey(
        "raw",
        encoder.encode(secreto),
        { name: "HMAC", hash: "SHA-256" },
        false,
        ["sign"]
    );
    const firma = await crypto.subtle.sign("HMAC", clave, encoder.encode(texto));
    return aBase64Url(new Uint8Array(firma));
}

function igualesEnTiempoConstante(a, b) {
    if (a.length !== b.length) return false;
    let resultado = 0;
    for (let i = 0; i < a.length; i++) {
        resultado |= a.charCodeAt(i) ^ b.charCodeAt(i);
    }
    return resultado === 0;
}

export async function crearCookieSesion(idUsuario, env) {
    const expira = Math.floor(Date.now() / 1000) + DURACION_SESION_SEG;
    const base = `${idUsuario}.${expira}`;
    const firma = await firmar(base, env.SESSION_SECRET);
    return `${NOMBRE_COOKIE}=${base}.${firma}; Path=/; Max-Age=${DURACION_SESION_SEG}; HttpOnly; Secure; SameSite=Lax`;
}

export function cookieBorrada() {
    return `${NOMBRE_COOKIE}=; Path=/; Max-Age=0; HttpOnly; Secure; SameSite=Lax`;
}

function leerCookie(request, nombre) {
    const cabecera = request.headers.get("Cookie") || "";
    for (const par of cabecera.split(";")) {
        const indice = par.indexOf("=");
        if (indice === -1) continue;
        if (par.slice(0, indice).trim() === nombre) {
            return par.slice(indice + 1).trim();
        }
    }
    return null;
}

async function idDesdeSesion(request, env) {
    if (!env.SESSION_SECRET) return null;

    const valor = leerCookie(request, NOMBRE_COOKIE);
    if (!valor) return null;

    const partes = valor.split(".");
    if (partes.length !== 3) return null;

    const [id, expira, firma] = partes;
    if (!/^[A-Za-z0-9_-]+$/.test(id) || !/^\d+$/.test(expira)) return null;
    if (Number(expira) < Math.floor(Date.now() / 1000)) return null;

    const esperada = await firmar(`${id}.${expira}`, env.SESSION_SECRET);
    return igualesEnTiempoConstante(firma, esperada) ? id : null;
}

// ----------------------------------------
// Protección básica contra pedidos de otros sitios (CSRF)
// ----------------------------------------

export function origenValido(request) {
    const origen = request.headers.get("Origin");
    if (!origen) return true;
    return origen === new URL(request.url).origin;
}

// ----------------------------------------
// Base de datos (Cloudflare D1)
// ----------------------------------------
//
// Las tablas se crean solas la primera vez que se usa la base,
// así no hace falta correr ningún comando de migración.

const ESQUEMA = [
    `CREATE TABLE IF NOT EXISTS usuarios (
        id TEXT PRIMARY KEY,
        email TEXT NOT NULL,
        foto TEXT,
        nombre TEXT,
        apellido TEXT,
        genero TEXT,
        ajustes TEXT NOT NULL DEFAULT '{}',
        creado INTEGER NOT NULL,
        ultimo_acceso INTEGER NOT NULL
    )`,
    `CREATE TABLE IF NOT EXISTS conversaciones (
        id TEXT PRIMARY KEY,
        usuario_id TEXT NOT NULL,
        titulo TEXT NOT NULL,
        creada INTEGER NOT NULL,
        actualizada INTEGER NOT NULL
    )`,
    `CREATE INDEX IF NOT EXISTS idx_conv_usuario
        ON conversaciones (usuario_id, actualizada DESC)`,
    `CREATE TABLE IF NOT EXISTS mensajes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        conversacion_id TEXT NOT NULL,
        rol TEXT NOT NULL,
        contenido TEXT NOT NULL,
        fuentes TEXT,
        origen TEXT NOT NULL DEFAULT 'texto',
        creado INTEGER NOT NULL
    )`,
    `CREATE INDEX IF NOT EXISTS idx_msg_conv
        ON mensajes (conversacion_id, id)`
];

let esquemaListo = null;

export function asegurarEsquema(env) {
    if (!env.DB) {
        throw new Error(
            "Falta la base de datos D1: crea una y enlázala al proyecto con el nombre DB."
        );
    }

    if (!esquemaListo) {
        esquemaListo = env.DB
            .batch(ESQUEMA.map((sql) => env.DB.prepare(sql)))
            .catch((e) => {
                esquemaListo = null;
                throw e;
            });
    }

    return esquemaListo;
}

// Solo para pruebas: permite reiniciar el estado entre bases distintas.
export function reiniciarCacheDeEsquema() {
    esquemaListo = null;
}

// ----------------------------------------
// Usuario y ajustes
// ----------------------------------------

export const AJUSTES_POR_DEFECTO = {
    tema: "auto",
    estilo: "equilibrado",
    buscarWeb: true
};

export function leerAjustes(texto) {
    let guardados = {};
    try {
        guardados = JSON.parse(texto || "{}") || {};
    } catch (e) {
        guardados = {};
    }
    return { ...AJUSTES_POR_DEFECTO, ...guardados };
}

export function usuarioPublico(fila) {
    return {
        id: fila.id,
        email: fila.email,
        foto: fila.foto || null,
        nombre: fila.nombre || "",
        apellido: fila.apellido || "",
        genero: fila.genero || "",
        ajustes: leerAjustes(fila.ajustes),
        perfilCompleto: Boolean(fila.nombre && fila.apellido && fila.genero)
    };
}

// Devuelve la fila del usuario logueado, o null.
export async function usuarioActual(context) {
    const { request, env } = context;

    await asegurarEsquema(env);

    const id = await idDesdeSesion(request, env);
    if (!id) return null;

    return env.DB
        .prepare("SELECT * FROM usuarios WHERE id = ?")
        .bind(id)
        .first();
}

// Atajo para los endpoints que exigen sesión. Devuelve
// { usuario } si todo está bien, o { respuesta } con el error.
export async function exigirUsuario(context, { mutante = false, perfil = true } = {}) {
    if (mutante && !origenValido(context.request)) {
        return { respuesta: error("Origen no permitido.", 403) };
    }

    const usuario = await usuarioActual(context);

    if (!usuario) {
        return { respuesta: error("Tienes que iniciar sesión.", 401) };
    }

    if (perfil && !(usuario.nombre && usuario.apellido && usuario.genero)) {
        return { respuesta: error("Completa tu perfil para continuar.", 403) };
    }

    return { usuario };
}

export function ahoraMs() {
    return Date.now();
}

export function limpiarTexto(valor, maximo) {
    return String(valor ?? "")
        .replace(/[\u0000-\u001F\u007F]+/g, " ")
        .replace(/\s+/g, " ")
        .trim()
        .slice(0, maximo);
}
