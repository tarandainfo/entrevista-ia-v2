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

    // Saturación: normalmente 85 (colorido). Para temas que
    // necesitan un fondo más neutro (blanco/negro/gris, como
    // tecnología), se puede bajar bastante.
    let saturacionActual = 85;
    let saturacionObjetivo = 85;

    let animando = false;

    // Se cachea una sola vez (en vez de hacer querySelectorAll
    // en cada cuadro, 60 veces por segundo).
    let elementosBrillo = null;
    let contadorCuadros = 0;

    // Modo landing (pantalla de inicio, antes de arrancar una
    // entrevista): matiz multicolor amplio, moviéndose rápido
    // (Propuesta B). Al arrancar la entrevista pasa a false, y
    // el fondo vuelve al comportamiento por tema de siempre.
    let modoLanding = true;


    // Cada blob tiene dos corrimientos de tono respecto al hue
    // base: uno chico ("normal", para el modo entrevista, donde
    // cada tema debe verse como "un color y sus matices") y uno
    // amplio ("landing", para la pantalla de inicio, donde
    // buscamos variedad de color bien visible).
    const blobs = [
        { xF: 0.25, yF: 0.3, rF: 0.55, corrimiento: 0, corrimientoAmplio: 0, vx: 0.00011, vy: 0.00009 },
        { xF: 0.75, yF: 0.65, rF: 0.6, corrimiento: 18, corrimientoAmplio: 60, vx: -0.00009, vy: 0.00012 },
        { xF: 0.5, yF: 0.85, rF: 0.5, corrimiento: -12, corrimientoAmplio: 100, vx: 0.00013, vy: -0.0001 },
        { xF: 0.15, yF: 0.75, rF: 0.4, corrimiento: 10, corrimientoAmplio: 20, vx: 0.0001, vy: -0.00008 }
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


    function setModoLanding(activo) {
        modoLanding = activo;
    }


    function pausar() {
        pausada = true;
    }


    function reanudar() {

        if (pausada) {
            pausada = false;
            requestAnimationFrame(bucleDeAnimacion);
        }
    }


    function setHueTema(hue, saturacion) {
        hueObjetivo = hue;
        saturacionObjetivo = (typeof saturacion === "number") ? saturacion : 85;
    }


    let pausada = false;

    function bucleDeAnimacion(t) {

        // Pausada (durante la entrevista, para liberar CPU para
        // el audio en tiempo real): dejamos de pedir más
        // cuadros hasta que alguien llame a reanudar().
        if (pausada) {
            return;
        }

        requestAnimationFrame(bucleDeAnimacion);

        if (!ctx || !ancho || !alto) {
            return;
        }

        // Nivel de audio real, suavizado.
        const nivelAudio = calcularNivelAudio();
        nivelSuavizado += (nivelAudio - nivelSuavizado) * 0.08;

        let intensidad;
        let hueDeCuadro;
        let velocidadBlobs;

        if (modoLanding) {

            // Propuesta B: matiz oscilando entre celeste y
            // violeta/magenta, respiración constante y blobs
            // bastante más rápidos — pensado para la pantalla
            // de inicio, antes de arrancar una entrevista.
            hueDeCuadro = 250 + Math.sin(t * 0.0009) * 45;

            intensidad = 0.45 + Math.sin(t * 0.0026) * 0.25;

            velocidadBlobs = 4.5;

        } else {

            // Modo entrevista: el tono se desliza suave hacia
            // el tema detectado, y la intensidad reacciona al
            // audio real (con un piso extra en modo "atráeme").
            hueActual += (hueObjetivo - hueActual) * 0.01;

            const respiracionIdle = modoAtraeme
                ? 0.25 + Math.sin(t * 0.0012) * 0.15
                : 0;

            intensidad = Math.max(nivelSuavizado, respiracionIdle);
            hueDeCuadro = hueActual;
            velocidadBlobs = 1;
        }

        saturacionActual += (saturacionObjetivo - saturacionActual) * 0.01;

        ctx.fillStyle = "#05070C";
        ctx.fillRect(0, 0, ancho, alto);
        ctx.globalCompositeOperation = "lighter";

        for (const b of blobs) {

            const cx = ancho * 0.5 + Math.sin(t * b.vx * velocidadBlobs) * ancho * 0.35 + (b.xF - 0.5) * ancho;
            const cy = alto * 0.5 + Math.cos(t * b.vy * velocidadBlobs) * alto * 0.35 + (b.yF - 0.5) * alto;

            const radio = b.rF * Math.min(ancho, alto) * (0.6 + intensidad * 0.35);
            const opacidad = 0.35 + intensidad * 0.35;

            const corrimiento = modoLanding ? b.corrimientoAmplio : b.corrimiento;
            const hue = hueDeCuadro + corrimiento;

            const g = ctx.createRadialGradient(cx, cy, 0, cx, cy, radio);
            g.addColorStop(0, "hsla(" + hue + ", " + saturacionActual + "%, 60%, " + opacidad + ")");
            g.addColorStop(1, "hsla(" + hue + ", " + saturacionActual + "%, 60%, 0)");

            // Pintamos solo el cuadrado que contiene al blob,
            // no el canvas entero: más allá del radio el
            // gradiente ya es transparente, así que pintar ahí
            // es trabajo de más (esto es lo que más pesaba).
            ctx.fillStyle = g;
            ctx.fillRect(cx - radio, cy - radio, radio * 2, radio * 2);
        }

        ctx.globalCompositeOperation = "source-over";

        // El brillo del texto no necesita actualizarse en los
        // 60 cuadros por segundo para verse fluido — cada 3
        // alcanza, y ahorra recálculos de estilo en el DOM.
        contadorCuadros++;
        if (contadorCuadros % 3 === 0) {
            actualizarBrilloReactivo(intensidad, hueDeCuadro);
        }
    }


    function actualizarBrilloReactivo(nivel, hue) {

        if (!elementosBrillo) {
            elementosBrillo = document.querySelectorAll(".marca, .marca-chica");
        }

        const intensidadGlow = 14 + nivel * 46;
        const opacidad = 0.35 + nivel * 0.55;

        const sombra = "0 0 " + intensidadGlow + "px hsla(" + hue + ", " + saturacionActual + "%, 65%, " + opacidad + ")";

        for (const el of elementosBrillo) {
            el.style.textShadow = sombra;
        }
    }


    window.FondoMalla = {
        iniciar,
        conectarAnalizador,
        setModoAtraeme,
        setModoLanding,
        setHueTema,
        pausar,
        reanudar
    };

})();
