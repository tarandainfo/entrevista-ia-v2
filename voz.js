// ========================================
// MOTOR DE VOZ (GEMINI LIVE)
// ========================================
//
// Conversación por voz en tiempo real. Es el mismo motor que ya
// venía funcionando (micrófono silenciado mientras LEDA habla,
// reconexión automática, ganancia y compresor en la salida),
// ahora sin pantallas propias: se maneja con callbacks.
//
// Uso:
//   await LedaVoz.iniciar({
//       pedirToken: async () => ({ token, instruccion }),
//       disparador: "texto que hace que LEDA salude primero",
//       onEstado(estado)        // conectando | escuchando | procesando | hablando | reconectando
//       onUsuario(textoParcial) // transcripción en vivo de lo que dice la persona
//       onModelo(textoParcial)  // transcripción en vivo de lo que dice LEDA
//       onTurno({ usuario, modelo }) // un turno completo (para guardarlo)
//       onError(mensaje)
//       onFin(motivo)           // usuario | conexion
//   });

(function (global) {

    const MODELO = "models/gemini-3.8-live";
    const VOZ = "Leda";

    let websocket = null;
    let audioContext = null;
    let gananciaSalida = null;
    let compresorSalida = null;
    let analizador = null;
    let flujoMicrofono = null;
    let nodoMicrofono = null;
    let fuenteMicrofono = null;

    let proximoInicio = 0;
    let fuentesProgramadas = [];

    let opciones = null;
    let instruccion = "";
    let detenido = true;
    let reconectando = false;
    let esReconexion = false;
    let handleReanudacion = null;

    let permitirMicrofono = false;
    let silenciado = false;
    let yaRespondio = false;

    let textoUsuario = "";
    let textoModelo = "";

    const temporizadores = new Set();

    function despues(ms, fn) {
        const id = setTimeout(() => { temporizadores.delete(id); fn(); }, ms);
        temporizadores.add(id);
    }

    function avisarEstado(estado) {
        if (opciones && opciones.onEstado) opciones.onEstado(estado);
    }

    // ----------------------------------------
    // Inicio y fin
    // ----------------------------------------

    async function iniciar(opts) {

        if (!detenido) return;

        detenido = false;
        opciones = opts;
        reconectando = false;
        esReconexion = false;
        handleReanudacion = null;
        permitirMicrofono = false;
        silenciado = false;
        yaRespondio = false;
        textoUsuario = "";
        textoModelo = "";
        proximoInicio = 0;

        // El AudioContext se crea de inmediato, dentro del clic de la
        // persona, para que el navegador permita reproducir audio.
        const Contexto = global.AudioContext || global.webkitAudioContext;
        audioContext = new Contexto();

        avisarEstado("conectando");

        try {
            const [credenciales] = await Promise.all([
                opts.pedirToken(),
                prepararAudio()
            ]);

            if (detenido) return;

            if (!credenciales || !credenciales.token) {
                throw new Error("No se pudo iniciar la voz.");
            }

            instruccion = credenciales.instruccion || "";
            conectar(credenciales.token, null);

        } catch (error) {
            const mensaje = traducirError(error);
            limpiar();
            if (opts.onError) opts.onError(mensaje);
        }
    }

    function traducirError(error) {
        if (error && (error.name === "NotAllowedError" || error.name === "SecurityError")) {
            return "No tengo permiso para usar el micrófono. Actívalo en el navegador y vuelve a intentarlo.";
        }
        if (error && error.name === "NotFoundError") {
            return "No encontré un micrófono en este dispositivo.";
        }
        return (error && error.message) || "No se pudo iniciar la voz.";
    }

    function detener(motivo = "usuario") {

        if (detenido) return;

        // Si había un turno a medias, lo entregamos para no perderlo.
        entregarTurno();

        const fin = opciones && opciones.onFin;

        limpiar();

        if (fin) fin(motivo);
    }

    function entregarTurno() {
        const usuario = textoUsuario.trim();
        const modelo = textoModelo.trim();

        textoUsuario = "";
        textoModelo = "";

        if ((usuario || modelo) && opciones && opciones.onTurno) {
            opciones.onTurno({ usuario, modelo });
        }
    }

    function limpiar() {
        detenido = true;

        temporizadores.forEach((id) => clearTimeout(id));
        temporizadores.clear();

        if (websocket) {
            websocket.onclose = null;
            websocket.onerror = null;
            try { websocket.close(1000); } catch (e) { /* ya cerrado */ }
            websocket = null;
        }

        fuentesProgramadas.forEach((f) => { try { f.stop(); } catch (e) { /* ya terminó */ } });
        fuentesProgramadas = [];

        if (nodoMicrofono) {
            try { nodoMicrofono.port.onmessage = null; nodoMicrofono.disconnect(); } catch (e) { /* nada */ }
            nodoMicrofono = null;
        }

        if (fuenteMicrofono) {
            try { fuenteMicrofono.disconnect(); } catch (e) { /* nada */ }
            fuenteMicrofono = null;
        }

        if (flujoMicrofono) {
            flujoMicrofono.getTracks().forEach((t) => t.stop());
            flujoMicrofono = null;
        }

        if (audioContext) {
            try { audioContext.close(); } catch (e) { /* nada */ }
            audioContext = null;
        }

        gananciaSalida = null;
        compresorSalida = null;
        analizador = null;
        permitirMicrofono = false;
    }

    // ----------------------------------------
    // WebSocket con Gemini Live
    // ----------------------------------------

    function conectar(token, handleParaReanudar) {

        const url =
            "wss://generativelanguage.googleapis.com/ws/" +
            "google.ai.generativelanguage.v1alpha.GenerativeService." +
            "BidiGenerateContentConstrained?access_token=" + token;

        esReconexion = Boolean(handleParaReanudar);

        const socket = new WebSocket(url);
        websocket = socket;

        socket.addEventListener("open", () => {

            const setup = {
                model: MODELO,

                generationConfig: {
                    responseModalities: ["AUDIO"],
                    speechConfig: {
                        voiceConfig: { prebuiltVoiceConfig: { voiceName: VOZ } },
                        languageCode: "es-419"
                    }
                },

                systemInstruction: { parts: [{ text: instruccion }] },

                realtimeInputConfig: {
                    automaticActivityDetection: {
                        startOfSpeechSensitivity: "START_SENSITIVITY_HIGH",
                        endOfSpeechSensitivity: "END_SENSITIVITY_HIGH",
                        prefixPaddingMs: 250,
                        silenceDurationMs: 200
                    }
                },

                inputAudioTranscription: {},
                outputAudioTranscription: {}
            };

            // Solo se manda cuando realmente estamos retomando una sesión.
            if (handleParaReanudar) {
                setup.sessionResumption = { handle: handleParaReanudar };
            }

            socket.send(JSON.stringify({ setup }));
        });

        socket.addEventListener("message", async (evento) => {

            let texto = evento.data;

            if (texto instanceof Blob) {
                texto = await texto.text();
            }

            let mensaje;
            try {
                mensaje = JSON.parse(texto);
            } catch (e) {
                return;
            }

            procesarMensaje(mensaje);
        });

        socket.addEventListener("close", () => {

            if (detenido || socket !== websocket) return;

            // Corte inesperado: si tenemos un handle, reconectamos solos.
            if (handleReanudacion && !reconectando) {
                reintentarConexion();
                return;
            }

            const fin = opciones && opciones.onFin;
            entregarTurno();
            limpiar();
            if (fin) fin("conexion");
        });

        socket.addEventListener("error", () => {

            if (detenido || socket !== websocket) return;

            const opcionesActuales = opciones;
            entregarTurno();
            limpiar();

            if (opcionesActuales && opcionesActuales.onError) {
                opcionesActuales.onError("Se perdió la conexión con LEDA.");
            }
        });
    }

    async function reintentarConexion() {

        reconectando = true;
        avisarEstado("reconectando");

        try {
            const credenciales = await opciones.pedirToken();

            if (detenido) return;
            if (!credenciales || !credenciales.token) throw new Error("Token vacío.");

            instruccion = credenciales.instruccion || instruccion;
            conectar(credenciales.token, handleReanudacion);

        } catch (e) {
            const opcionesActuales = opciones;
            entregarTurno();
            limpiar();
            if (opcionesActuales && opcionesActuales.onError) {
                opcionesActuales.onError("Se perdió la conexión con LEDA.");
            }
        } finally {
            reconectando = false;
        }
    }

    function enviarTexto(texto) {
        if (websocket && websocket.readyState === WebSocket.OPEN) {
            websocket.send(JSON.stringify({
                clientContent: {
                    turns: [{ role: "user", parts: [{ text: texto }] }],
                    turnComplete: true
                }
            }));
        }
    }

    function enviarDisparador() {
        enviarTexto(opciones.disparador || "Salúdame brevemente y pregúntame en qué puedes ayudarme.");
    }

    // ----------------------------------------
    // Mensajes de Gemini
    // ----------------------------------------

    function procesarMensaje(mensaje) {

        if (mensaje.sessionResumptionUpdate && mensaje.sessionResumptionUpdate.newHandle) {
            handleReanudacion = mensaje.sessionResumptionUpdate.newHandle;
        }

        // La persona dejó de hablar: hasta que llegue el audio de LEDA,
        // el modelo está generando la respuesta.
        if (mensaje.voiceActivity && mensaje.voiceActivity.type === "ACTIVITY_END") {
            avisarEstado("procesando");
        }

        if (mensaje.setupComplete) {

            avisarEstado("escuchando");

            if (esReconexion) {

                despues(300, () => enviarTexto(
                    "Seguimos con la misma conversación de antes (se cortó la conexión " +
                    "un instante). No te vuelvas a presentar ni saludes de nuevo: " +
                    "continúa naturalmente donde habíamos quedado."
                ));

            } else {

                yaRespondio = false;

                // Un pequeño margen antes del disparador, para no competir
                // con audio real del micrófono.
                despues(300, enviarDisparador);

                // Red de seguridad: si no arrancó a hablar, reintenta una vez.
                despues(6000, () => {
                    if (!yaRespondio && !detenido) enviarDisparador();
                });
            }

            esReconexion = false;
            return;
        }

        const contenido = mensaje.serverContent;
        if (!contenido) return;

        if (contenido.interrupted) {
            fuentesProgramadas.forEach((f) => { try { f.stop(); } catch (e) { /* ya terminó */ } });
            fuentesProgramadas = [];
            proximoInicio = 0;
        }

        if (contenido.modelTurn && contenido.modelTurn.parts) {

            avisarEstado("hablando");

            // Mientras LEDA habla, el micrófono queda silenciado.
            permitirMicrofono = false;
            yaRespondio = true;

            for (const parte of contenido.modelTurn.parts) {
                if (parte.inlineData && parte.inlineData.data) {
                    reproducir(parte.inlineData.data);
                }
            }
        }

        if (contenido.inputTranscription && contenido.inputTranscription.text) {
            textoUsuario += contenido.inputTranscription.text;
            if (opciones.onUsuario) opciones.onUsuario(textoUsuario);
        }

        if (contenido.outputTranscription && contenido.outputTranscription.text) {
            textoModelo += contenido.outputTranscription.text;
            if (opciones.onModelo) opciones.onModelo(textoModelo);
        }

        if (contenido.turnComplete) {

            avisarEstado("escuchando");
            permitirMicrofono = true;

            entregarTurno();
        }
    }

    // ----------------------------------------
    // Micrófono
    // ----------------------------------------

    async function prepararAudio() {

        flujoMicrofono = await navigator.mediaDevices.getUserMedia({
            audio: {
                channelCount: 1,
                echoCancellation: true,
                noiseSuppression: true,
                autoGainControl: true
            }
        });

        if (detenido || !audioContext) {
            if (flujoMicrofono) flujoMicrofono.getTracks().forEach((t) => t.stop());
            return;
        }

        await audioContext.resume();

        // Salida de LEDA: ganancia fija + compresor que nivela el volumen
        // y evita que se distorsione.
        gananciaSalida = audioContext.createGain();
        gananciaSalida.gain.value = 2.2;

        compresorSalida = audioContext.createDynamicsCompressor();
        compresorSalida.threshold.value = -24;
        compresorSalida.knee.value = 10;
        compresorSalida.ratio.value = 14;
        compresorSalida.attack.value = 0.002;
        compresorSalida.release.value = 0.15;

        gananciaSalida.connect(compresorSalida);
        compresorSalida.connect(audioContext.destination);

        analizador = audioContext.createAnalyser();
        analizador.fftSize = 256;
        analizador.smoothingTimeConstant = 0.4;

        await audioContext.audioWorklet.addModule("mic-processor.js");

        if (detenido || !audioContext) return;

        fuenteMicrofono = audioContext.createMediaStreamSource(flujoMicrofono);
        nodoMicrofono = new AudioWorkletNode(audioContext, "mic-processor");

        nodoMicrofono.port.onmessage = (evento) => {

            if (!websocket || websocket.readyState !== WebSocket.OPEN) return;
            if (!permitirMicrofono || silenciado) return;

            websocket.send(JSON.stringify({
                realtimeInput: {
                    audio: {
                        data: aBase64(evento.data),
                        mimeType: "audio/pcm;rate=16000"
                    }
                }
            }));
        };

        // No se conecta a la salida: no queremos oír nuestro propio micrófono.
        fuenteMicrofono.connect(nodoMicrofono);
    }

    // ----------------------------------------
    // Reproducción sin cortes
    // ----------------------------------------

    function reproducir(base64) {

        if (!audioContext) return;

        const binario = atob(base64);
        const bytes = new Uint8Array(binario.length);

        for (let i = 0; i < binario.length; i++) {
            bytes[i] = binario.charCodeAt(i);
        }

        const int16 = new Int16Array(bytes.buffer, 0, Math.floor(bytes.length / 2));
        const float32 = new Float32Array(int16.length);

        for (let i = 0; i < int16.length; i++) {
            float32[i] = int16[i] / 32768;
        }

        // Fundido brevísimo en los bordes de cada pedacito para evitar
        // clics, limitado para no afectar pedacitos cortos.
        const fundido = Math.min(Math.round(24000 * 0.004), Math.floor(float32.length * 0.08));
        const n = Math.min(fundido, Math.floor(float32.length / 4));

        for (let i = 0; i < n; i++) {
            const factor = i / n;
            float32[i] *= factor;
            float32[float32.length - 1 - i] *= factor;
        }

        const buffer = audioContext.createBuffer(1, float32.length, 24000);
        buffer.getChannelData(0).set(float32);

        programar(buffer);
    }

    function programar(buffer) {

        const ahora = audioContext.currentTime;

        // Si el cursor quedó atrás, damos un pequeño colchón.
        if (proximoInicio < ahora) {
            proximoInicio = ahora + 0.15;
        }

        const fuente = audioContext.createBufferSource();
        fuente.buffer = buffer;

        fuente.connect(gananciaSalida || audioContext.destination);
        if (analizador) fuente.connect(analizador);

        fuente.start(proximoInicio);
        fuentesProgramadas.push(fuente);

        fuente.onended = () => {
            fuentesProgramadas = fuentesProgramadas.filter((f) => f !== fuente);
        };

        proximoInicio += buffer.duration;
    }

    function aBase64(buffer) {
        const bytes = new Uint8Array(buffer);
        let binario = "";

        for (let i = 0; i < bytes.length; i++) {
            binario += String.fromCharCode(bytes[i]);
        }

        return btoa(binario);
    }

    // ----------------------------------------
    // Utilidades para la interfaz
    // ----------------------------------------

    function silenciar(valor) {
        silenciado = Boolean(valor);
    }

    // Nivel de volumen actual (0 a 1), para animar la esfera.
    function nivel() {
        if (!analizador) return 0;

        const datos = new Uint8Array(analizador.frequencyBinCount);
        analizador.getByteFrequencyData(datos);

        let suma = 0;
        for (let i = 0; i < datos.length; i++) suma += datos[i];

        return Math.min(1, suma / datos.length / 140);
    }

    function activa() {
        return !detenido;
    }

    global.LedaVoz = { iniciar, detener, silenciar, nivel, activa };

})(window);
