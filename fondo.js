// ========================================
// FONDO DE MALLA LÍQUIDA
// ========================================
//
// Reemplaza a la red de partículas anterior. Son manchas de
// color (blobs) fluyendo y mezclándose lentamente. Reacciona
// a tres cosas:
//
// 1. Audio real de LEDA: los blobs se agrandan y brillan más
//    cuando está hablando (igual que antes con las
//    partículas).
// 2. Tema de la entrevista: un leve matiz de color distinto
//    según palabras clave del tema (sin salirse nunca de la
//    familia celeste/violeta/verde-agua de la marca).
// 3. Modo "atráeme": si nadie interactúa por un rato en la
//    pantalla de inicio, el fondo se pone un poco más vivo
//    para llamar la atención de gente que pasa caminando.
//
// Se expone como `window.FondoMalla`.

(function () {

    let canvas, ctx;
    let ancho = 0, alto = 0;

    let analizador = null;
    let datosAudio = null;
    let nivelSuavizado = 0;

    let modoAtraeme = false;

    let hueActual = 205;
    let hueObjetivo = 205;

    let animando = false;


    // Cada blob tiene un corrimiento de tono fijo respecto
    // al hue base, para mantener la mezcla de colores aunque
    // el hue base cambie según el tema.
    const blobs = [
        { xF: 0.25, yF: 0.3, rF: 0.55, corrimiento: 0, vx: 0.00011, vy: 0.00009 },
        { xF: 0.75, yF: 0.65, rF: 0.6, corrimiento: 60, vx: -0.00009, vy: 0.00012 },
        { xF: 0.5, yF: 0.85, rF: 0.5, corrimiento: -40, vx: 0.00013, vy: -0.0001 },
        { xF: 0.15, yF: 0.75, rF: 0.4, corrimiento: 20, vx: 0.0001, vy: -0.00008 }
    ];


    function iniciar(idCanvas) {

        canvas = document.getElementById(idCanvas);

        if (!canvas) {
            console.error("No se encontró el canvas:", idCanvas);
            return;
        }

        ctx = canvas.getContext("2d");

        ajustarTamano();
        window.addEventListener("resize", ajustarTamano);

        if (!animando) {
            animando = true;
            requestAnimationFrame(bucleDeAnimacion);
        }
    }


    function ajustarTamano() {

        if (!canvas) {
            return;
        }

        ancho = canvas.width = canvas.clientWidth;
        alto = canvas.height = canvas.clientHeight;
    }


    function conectarAnalizador(nodoAnalizador) {

        analizador = nodoAnalizador;
        datosAudio = new Uint8Array(analizador.fftSize);
    }


    function calcularNivelAudio() {

        if (!analizador || !datosAudio) {
            return 0;
        }

        analizador.getByteTimeDomainData(datosAudio);

        let sumaCuadrados = 0;

        for (let i = 0; i < datosAudio.length; i++) {
            const valor = (datosAudio[i] - 128) / 128;
            sumaCuadrados += valor * valor;
        }

        const rms = Math.sqrt(sumaCuadrados / datosAudio.length);

        return Math.min(1, rms * 6);
    }


    function setModoAtraeme(activo) {
        modoAtraeme = activo;
    }


    function setHueTema(hue) {
        hueObjetivo = hue;
    }


    function bucleDeAnimacion(t) {

        requestAnimationFrame(bucleDeAnimacion);

        if (!ctx || !ancho || !alto) {
            return;
        }

        // Nivel de audio real, suavizado.
        const nivelAudio = calcularNivelAudio();
        nivelSuavizado += (nivelAudio - nivelSuavizado) * 0.08;

        // En modo "atráeme" agregamos un piso de actividad
        // (una respiración lenta) aunque no haya audio.
        const respiracionIdle = modoAtraeme
            ? 0.25 + Math.sin(t * 0.0012) * 0.15
            : 0;

        const intensidad = Math.max(nivelSuavizado, respiracionIdle);

        // El tono base se desliza suavemente hacia el tema
        // detectado, en vez de saltar de golpe.
        hueActual += (hueObjetivo - hueActual) * 0.01;

        ctx.fillStyle = "#05070C";
        ctx.fillRect(0, 0, ancho, alto);
        ctx.globalCompositeOperation = "lighter";

        for (const b of blobs) {

            const cx = ancho * 0.5 + Math.sin(t * b.vx) * ancho * 0.35 + (b.xF - 0.5) * ancho;
            const cy = alto * 0.5 + Math.cos(t * b.vy) * alto * 0.35 + (b.yF - 0.5) * alto;

            const radio = b.rF * Math.min(ancho, alto) * (0.6 + intensidad * 0.35);
            const opacidad = 0.35 + intensidad * 0.35;

            const hue = hueActual + b.corrimiento;

            const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, radio);
            g.addColorStop(0, "hsla(" + hue + ", 85%, 60%, " + opacidad + ")");
            g.addColorStop(1, "hsla(" + hue + ", 85%, 60%, 0)");

            ctx.fillStyle = g;
            ctx.fillRect(0, 0, ancho, alto);
        }

        ctx.globalCompositeOperation = "source-over";

        actualizarBrilloReactivo(intensidad, hueActual);
    }


    function actualizarBrilloReactivo(nivel, hue) {

        const elementos = document.querySelectorAll(".marca, .marca-chica");

        const intensidadGlow = 14 + nivel * 46;
        const opacidad = 0.35 + nivel * 0.55;

        const sombra = "0 0 " + intensidadGlow + "px hsla(" + hue + ", 85%, 65%, " + opacidad + ")";

        for (const el of elementos) {
            el.style.textShadow = sombra;
        }
    }


    window.FondoMalla = {
        iniciar,
        conectarAnalizador,
        setModoAtraeme,
        setHueTema
    };

})();
