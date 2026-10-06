import { json } from "../_lib/util.js";

// Datos públicos que necesita la página antes de iniciar sesión.
// El ID de cliente de Google NO es un secreto: va en el navegador.
export async function onRequestGet(context) {
    return json({
        googleClientId: context.env.GOOGLE_CLIENT_ID || ""
    });
}
