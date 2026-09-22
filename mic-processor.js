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

            const pcm16 = this._remuestrearAPCM16(
                juntado,
                sampleRate,
                this.targetSampleRate
            );

            // Portón de silencio: si el pedacito es
            // prácticamente silencio (o un murmullo de fondo
            // muy bajo), ni lo mandamos. Esto NO separa dos
            // personas hablando a la vez cerca del micrófono
            // — eso requiere un micrófono direccional, no hay
            // forma de resolverlo por software — pero evita
            // que un ruido de fondo constante y bajo (aire
            // acondicionado, murmullo lejano) se cuele en los
            // huecos de silencio real entre frases.
            if (this._esSilencio(juntado)) {
                return true;
            }

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

    _esSilencio(buffer) {

        let sumaCuadrados = 0;

        for (let i = 0; i < buffer.length; i++) {
            sumaCuadrados += buffer[i] * buffer[i];
        }

        const rms = Math.sqrt(sumaCuadrados / buffer.length);

        // Umbral conservador: solo filtra silencio/ruido muy
        // bajo, para no arriesgarnos a cortar el inicio de una
        // voz suave. Se puede ajustar si hace falta.
        const UMBRAL_SILENCIO = 0.008;

        return rms < UMBRAL_SILENCIO;
    }
}

registerProcessor("mic-processor", MicProcessor);
