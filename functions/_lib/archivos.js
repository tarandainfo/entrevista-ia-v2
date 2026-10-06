// Busca en un mensaje de LEDA los bloques ```leda-archivo ... ```
// y devuelve las especificaciones de archivo válidas.

export function extraerArchivos(texto) {
    const resultado = [];
    const patron = /```leda-archivo\s*([\s\S]*?)```/g;
    let coincidencia;

    while ((coincidencia = patron.exec(texto || "")) !== null) {
        try {
            const spec = JSON.parse(coincidencia[1].trim());

            if (
                spec &&
                typeof spec.tipo === "string" &&
                typeof spec.nombre === "string" &&
                spec.nombre.length > 0
            ) {
                resultado.push(spec);
            }
        } catch (e) {
            // Bloque con JSON inválido: se ignora.
        }
    }

    return resultado;
}
