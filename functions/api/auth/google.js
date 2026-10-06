import {
    json,
    error,
    origenValido,
    asegurarEsquema,
    crearCookieSesion,
    usuarioPublico,
    ahoraMs
} from "../../_lib/util.js";

// Recibe el "credential" (un JWT) que entrega el botón de Google,
// le pide a Google que lo verifique y abre la sesión.

export async function onRequestPost(context) {
    const { request, env } = context;

    if (!origenValido(request)) {
        return error("Origen no permitido.", 403);
    }

    if (!env.GOOGLE_CLIENT_ID || !env.SESSION_SECRET) {
        return error(
            "Falta configurar GOOGLE_CLIENT_ID y SESSION_SECRET en el servidor.",
            500
        );
    }

    let cuerpo;
    try {
        cuerpo = await request.json();
    } catch (e) {
        return error("Pedido inválido.");
    }

    const credencial = cuerpo && cuerpo.credential;
    if (typeof credencial !== "string" || credencial.length < 20 || credencial.length > 4096) {
        return error("Credencial inválida.");
    }

    try {
        await asegurarEsquema(env);

        const base = env.GOOGLE_TOKENINFO_URL || "https://oauth2.googleapis.com/tokeninfo";
        const verificacion = await fetch(`${base}?id_token=${encodeURIComponent(credencial)}`);

        if (!verificacion.ok) {
            return error("Google no pudo verificar tu sesión. Intenta de nuevo.", 401);
        }

        const datos = await verificacion.json();

        const emisorOk =
            datos.iss === "accounts.google.com" ||
            datos.iss === "https://accounts.google.com";
        const audienciaOk = datos.aud === env.GOOGLE_CLIENT_ID;
        const emailVerificado = datos.email_verified === true || datos.email_verified === "true";
        const vigente = Number(datos.exp) > Math.floor(Date.now() / 1000);

        if (!emisorOk || !audienciaOk || !emailVerificado || !vigente || !datos.sub) {
            return error("No se pudo validar tu cuenta de Google.", 401);
        }

        const id = String(datos.sub);
        const ahora = ahoraMs();

        const existente = await env.DB
            .prepare("SELECT * FROM usuarios WHERE id = ?")
            .bind(id)
            .first();

        if (existente) {
            await env.DB
                .prepare("UPDATE usuarios SET email = ?, foto = ?, ultimo_acceso = ? WHERE id = ?")
                .bind(datos.email, datos.picture || null, ahora, id)
                .run();
        } else {
            await env.DB
                .prepare(
                    "INSERT INTO usuarios (id, email, foto, ajustes, creado, ultimo_acceso) VALUES (?, ?, ?, '{}', ?, ?)"
                )
                .bind(id, datos.email, datos.picture || null, ahora, ahora)
                .run();
        }

        const fila = await env.DB
            .prepare("SELECT * FROM usuarios WHERE id = ?")
            .bind(id)
            .first();

        const cookie = await crearCookieSesion(id, env);

        return json(
            { usuario: usuarioPublico(fila), nuevo: !existente },
            200,
            { "Set-Cookie": cookie }
        );

    } catch (e) {
        console.error("Error en /api/auth/google:", e);
        return error("No se pudo iniciar sesión: " + e.message, 500);
    }
}
