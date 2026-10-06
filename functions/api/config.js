import { json } from "../_lib/util.js";

// Datos públicos que necesita la página antes de empezar.
// El ID de cliente de Google NO es un secreto: va en el navegador.
//
// Las cuentas (inicio de sesión con Google + historial en la base de
// datos) están APAGADAS por defecto. Para encenderlas, definir la
// variable MODO_CUENTAS=si y completar la configuración de Google y D1.
export async function onRequestGet(context) {
    return json({
        cuentas: context.env.MODO_CUENTAS === "si",
        googleClientId: context.env.GOOGLE_CLIENT_ID || ""
    });
}
