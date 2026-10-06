import { json, error, origenValido, cookieBorrada } from "../../_lib/util.js";

export async function onRequestPost(context) {

    if (!origenValido(context.request)) {
        return error("Origen no permitido.", 403);
    }

    return json({ ok: true }, 200, { "Set-Cookie": cookieBorrada() });
}
