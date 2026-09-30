// ========================================
// PROCESADOR DE MICRÓFONO (AUDIO WORKLET)
// ========================================
//
// Corre en un hilo de audio dedicado, separado del hilo
// principal, para no competir con la reproducción del
// audio de la IA. Remuestrea el micrófono a 16kHz y lo
// convierte a PCM16, que es lo que espera la API de
// Gemini Live.

class MicProcessor extends AudioWorkletProcessor {

    constructor() {
        super();

        this.targetSampleRate = 16000;
        this.chunkSize = 4096;

        this.buffers = [];
        this.samplesAcumulados = 0;
    }

    process(inputs) {

        const input = inputs[0];

        if (!input || input.length === 0) {
            return true;
        }

        const canal = input[0];

        if (!canal || canal.length === 0) {
            return true;
        }

        this.buffers.push(Float32Array.from(canal));
        this.samplesAcumulados += canal.length;

        if (this.samplesAcumulados >= this.chunkSize) {

            const juntado = this._juntarBuffers(this.buffers, this.samplesAcumulados);

            this.buffers = [];
            this.samplesAcumulados = 0;

            // Filtro de silencio + nivelación: si el pedacito
            // es puro murmullo de fondo (por debajo del umbral),
            // lo mandamos como silencio real en vez de recortar
            // el envío (recortar el envío en sí rompía la
            // detección de turno de Gemini, ya lo probamos). Si
            // hay voz real, nivelamos el volumen para que quede
            // más parejo.
            this._procesarNivel(juntado);

            const pcm16 = this._remuestrearAPCM16(
                juntado,
                sampleRate,
                this.targetSampleRate
            );

            this.port.postMessage(pcm16, [pcm16]);
        }

        return true;
    }

    _juntarBuffers(buffers, largoTotal) {

        const resultado = new Float32Array(largoTotal);
        let offset = 0;

        for (const buffer of buffers) {
            resultado.set(buffer, offset);
            offset += buffer.length;
        }

        return resultado;
    }

    _procesarNivel(buffer) {

        // RMS: qué tan fuerte es, en promedio, este pedacito.
        let sumaCuadrados = 0;

        for (let i = 0; i < buffer.length; i++) {
            sumaCuadrados += buffer[i] * buffer[i];
        }

        const rms = Math.sqrt(sumaCuadrados / buffer.length);

        // Umbral conservador: solo silencia murmullo de fondo
        // muy bajo (aire acondicionado, gente lejos), no
        // arriesga cortar el inicio de una voz suave cercana.
        const UMBRAL_SILENCIO = 0.012;

        if (rms < UMBRAL_SILENCIO) {
            buffer.fill(0);
            return;
        }

        // Nivelación (compresión suave): si la voz llegó floja,
        // la subimos hacia un nivel objetivo; si llegó fuerte,
        // no la tocamos de más (el límite final a [-1, 1] en el
        // remuestreo ya actúa como tope contra picos).
        const NIVEL_OBJETIVO = 0.18;
        const GANANCIA_MAXIMA = 3;

        const ganancia = Math.min(GANANCIA_MAXIMA, NIVEL_OBJETIVO / rms);

        if (ganancia > 1) {
            for (let i = 0; i < buffer.length; i++) {
                buffer[i] *= ganancia;
            }
        }
    }

    _remuestrearAPCM16(buffer, sampleRateOrigen, sampleRateDestino) {

        const ratio = sampleRateOrigen / sampleRateDestino;
        const nuevoLargo = Math.round(buffer.length / ratio);
        const resultado = new Int16Array(nuevoLargo);

        let offsetResultado = 0;
        let offsetBuffer = 0;

        while (offsetResultado < resultado.length) {

            const siguienteOffset = Math.round((offsetResultado + 1) * ratio);

            let acumulador = 0;
            let cantidad = 0;

            for (let i = offsetBuffer; i < siguienteOffset && i < buffer.length; i++) {
                acumulador += buffer[i];
                cantidad++;
            }

            const valor = cantidad > 0 ? acumulador / cantidad : 0;

            resultado[offsetResultado] = Math.max(-1, Math.min(1, valor)) * 32767;

            offsetResultado++;
            offsetBuffer = siguienteOffset;
        }

        return resultado.buffer;
    }
}

registerProcessor("mic-processor", MicProcessor);
