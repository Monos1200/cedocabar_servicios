// js/tickets.js
let usuarioSesion = null;
let fotosSeleccionadas = []; // Almacena objetos { blob: Blob, previewUrl: string }
let fotosAdicionalesCierre = []; // Buffer temporal para fotos adjuntadas al cerrar/actualizar
const MAX_FOTOS = 5;
let ticketsCache = [];
let ticketsFiltradosActuales = [];

document.addEventListener('DOMContentLoaded', async () => {
    // 1. Verificar sesión
    const rawSesion = localStorage.getItem('cedocabar_sesion');
    if (!rawSesion) {
        window.location.href = 'index.html';
        return;
    }
    usuarioSesion = JSON.parse(rawSesion);

    // Mostrar datos en barra superior
    document.getElementById('lblNombreTecnico').textContent = `${usuarioSesion.nombre_completo} (${usuarioSesion.rol.toUpperCase()})`;

    // Mostrar pestaña de técnicos y filtro de técnicos solo si es admin
    if (usuarioSesion.rol === 'admin') {
        document.getElementById('navItemTecnicos').classList.remove('d-none');
        const contenedorFiltroTec = document.getElementById('contenedorFiltroTecnico');
        if (contenedorFiltroTec) contenedorFiltroTec.classList.remove('d-none');
        await cargarSelectorFiltroTecnicos();
    }

    // Cerrar sesión
    document.getElementById('btnCerrarSesion').addEventListener('click', () => {
        Swal.fire({
            title: '¿Cerrar sesión?',
            text: 'Saldrá del sistema de soporte técnico CEDOCABAR.',
            icon: 'question',
            showCancelButton: true,
            confirmButtonColor: '#0b2545',
            cancelButtonColor: '#6c757d',
            confirmButtonText: 'Sí, salir',
            cancelButtonText: 'Cancelar'
        }).then((res) => {
            if (res.isConfirmed) {
                localStorage.removeItem('cedocabar_sesion');
                window.location.href = 'index.html';
            }
        });
    });

    // Inicializar correlativo y cargar tickets
    await generarSiguienteCorrelativo();
    await cargarTickets();

    // Ocultar preloader
    setTimeout(() => {
        const preloader = document.getElementById('preloader');
        if (preloader) preloader.classList.add('hidden');
    }, 400);

    // Eventos de carga de imágenes (Cámara y Galería) en nuevo ticket
    document.getElementById('inputCamara').addEventListener('change', manejarSeleccionFotos);
    document.getElementById('inputGaleria').addEventListener('change', manejarSeleccionFotos);

    // Evento guardar ticket
    document.getElementById('formNuevoTicket').addEventListener('submit', guardarTicketCompleto);

    // Eventos de búsqueda, filtros, reportes y refresco en historial
    document.getElementById('buscarTicket').addEventListener('input', aplicarFiltrosHistorial);
    document.getElementById('filtroTecnico').addEventListener('change', aplicarFiltrosHistorial);
    document.getElementById('filtroEstatus').addEventListener('change', aplicarFiltrosHistorial);
    document.getElementById('filtroFechaDesde').addEventListener('change', aplicarFiltrosHistorial);
    document.getElementById('filtroFechaHasta').addEventListener('change', aplicarFiltrosHistorial);

    document.getElementById('btnLimpiarFiltros').addEventListener('click', () => {
        document.getElementById('buscarTicket').value = '';
        document.getElementById('filtroTecnico').value = 'Todos';
        document.getElementById('filtroEstatus').value = 'Todos';
        document.getElementById('filtroFechaDesde').value = '';
        document.getElementById('filtroFechaHasta').value = '';
        aplicarFiltrosHistorial();
    });

    document.getElementById('btnImprimirConsolidado').addEventListener('click', imprimirReporteConsolidado);
    document.getElementById('btnExportarCSV').addEventListener('click', exportarTicketsFiltradosCSV);
    document.getElementById('btnRefrescarTickets').addEventListener('click', cargarTickets);
});

// Poblar el selector de técnicos para el filtro del administrador
async function cargarSelectorFiltroTecnicos() {
    const select = document.getElementById('filtroTecnico');
    if (!select) return;

    try {
        const { data, error } = await supabaseClient
            .from('tecnicos')
            .select('id, nombre_completo, activo')
            .order('nombre_completo', { ascending: true });

        if (error) throw error;

        const valorPrevio = select.value || 'Todos';
        select.innerHTML = '<option value="Todos">Todos los técnicos</option>';

        (data || []).forEach(tec => {
            const option = document.createElement('option');
            option.value = tec.id;
            option.textContent = tec.activo ? tec.nombre_completo : `${tec.nombre_completo} (Inactivo)`;
            select.appendChild(option);
        });

        select.value = valorPrevio;
    } catch (err) {
        console.error('Error cargando selector de técnicos:', err);
    }
}

// Generar correlativo automático: TKT-2026-0001
async function generarSiguienteCorrelativo() {
    const anioActual = new Date().getFullYear();
    const prefijo = `TKT-${anioActual}-`;

    try {
        const { data, error } = await supabaseClient
            .from('tickets')
            .select('numero_ticket')
            .ilike('numero_ticket', `${prefijo}%`)
            .order('numero_ticket', { ascending: false })
            .limit(1);

        if (error) throw error;

        let siguienteNumero = 1;
        if (data && data.length > 0) {
            const partes = data[0].numero_ticket.split('-');
            const ultimoNum = parseInt(partes[2], 10);
            if (!isNaN(ultimoNum)) siguienteNumero = ultimoNum + 1;
        }

        const correlativoFormateado = `${prefijo}${String(siguienteNumero).padStart(4, '0')}`;
        document.getElementById('badgeNumeroTicket').textContent = correlativoFormateado;
        return correlativoFormateado;
    } catch (err) {
        console.error('Error generando correlativo:', err);
        const fallback = `${prefijo}${Date.now().toString().slice(-4)}`;
        document.getElementById('badgeNumeroTicket').textContent = fallback;
        return fallback;
    }
}

// Comprimir imagen usando Canvas antes de agregarla
function comprimirImagen(archivo, maxWidth = 1280, calidad = 0.75) {
    return new Promise((resolve, reject) => {
        const lector = new FileReader();
        lector.readAsDataURL(archivo);
        lector.onload = (event) => {
            const img = new Image();
            img.src = event.target.result;
            img.onload = () => {
                const canvas = document.createElement('canvas');
                let width = img.width;
                let height = img.height;

                if (width > maxWidth) {
                    height = Math.round((height * maxWidth) / width);
                    width = maxWidth;
                }

                canvas.width = width;
                canvas.height = height;
                const ctx = canvas.getContext('2d');
                ctx.drawImage(img, 0, 0, width, height);

                canvas.toBlob((blob) => {
                    if (blob) {
                        resolve({
                            blob: blob,
                            previewUrl: URL.createObjectURL(blob)
                        });
                    } else {
                        reject(new Error('No se pudo comprimir la imagen'));
                    }
                }, 'image/jpeg', calidad);
            };
            img.onerror = reject;
        };
        lector.onerror = reject;
    });
}

// Manejar selección desde cámara o galería con límite estricto de 5
async function manejarSeleccionFotos(e) {
    const archivos = Array.from(e.target.files);
    if (!archivos.length) return;

    const cupoDisponible = MAX_FOTOS - fotosSeleccionadas.length;
    if (cupoDisponible <= 0) {
        Swal.fire({
            icon: 'warning',
            title: 'Límite alcanzado',
            text: 'Solo se permiten máximo 5 fotografías por ticket.',
            confirmButtonColor: '#0b2545'
        });
        e.target.value = '';
        return;
    }

    let archivosAProcesar = archivos;
    if (archivos.length > cupoDisponible) {
        Swal.fire({
            icon: 'info',
            title: 'Límite de 5 fotos',
            text: `Solo se agregarán las primeras ${cupoDisponible} foto(s) para no superar el máximo permitido.`,
            confirmButtonColor: '#0b2545'
        });
        archivosAProcesar = archivos.slice(0, cupoDisponible);
    }

    for (const archivo of archivosAProcesar) {
        if (!archivo.type.startsWith('image/')) continue;
        try {
            const comprimida = await comprimirImagen(archivo);
            fotosSeleccionadas.push(comprimida);
        } catch (err) {
            console.error('Error procesando foto:', err);
        }
    }

    e.target.value = '';
    renderizarMiniaturas();
}

// Dibujar miniaturas y actualizar contador en nuevo ticket
function renderizarMiniaturas() {
    const contenedor = document.getElementById('contenedorMiniaturas');
    const contador = document.getElementById('contadorFotos');
    const lblCamara = document.getElementById('lblTomarFoto');
    const lblGaleria = document.getElementById('lblGaleriaFoto');

    contenedor.innerHTML = '';
    contador.textContent = `${fotosSeleccionadas.length} / ${MAX_FOTOS} fotos`;

    const lleno = fotosSeleccionadas.length >= MAX_FOTOS;
    lblCamara.classList.toggle('disabled', lleno);
    lblGaleria.classList.toggle('disabled', lleno);

    fotosSeleccionadas.forEach((item, index) => {
        const box = document.createElement('div');
        box.className = 'photo-preview-box';
        box.innerHTML = `
            <img src="${item.previewUrl}" alt="Evidencia ${index + 1}">
            <button type="button" class="btn btn-danger btn-remove-photo" onclick="eliminarFoto(${index})" title="Quitar foto">
                <i class="bi bi-x"></i>
            </button>
        `;
        contenedor.appendChild(box);
    });
}

window.eliminarFoto = function(index) {
    URL.revokeObjectURL(fotosSeleccionadas[index].previewUrl);
    fotosSeleccionadas.splice(index, 1);
    renderizarMiniaturas();
};

// Guardar Ticket y subir hasta 5 fotos a Supabase Storage
async function guardarTicketCompleto(e) {
    e.preventDefault();

    const departamento = document.getElementById('departamento_destino').value.trim();
    const equipo = document.getElementById('equipo_referencia').value.trim();
    const tipoFalla = document.getElementById('tipo_falla').value;
    const estatus = document.getElementById('estatus').value;
    const descripcion = document.getElementById('descripcion_tarea').value.trim();

    if (!departamento || !equipo || !tipoFalla || !descripcion) {
        Swal.fire('Campos requeridos', 'Complete todos los datos obligatorios del soporte.', 'warning');
        return;
    }

    const btnGuardar = document.getElementById('btnGuardarTicket');
    btnGuardar.disabled = true;
    btnGuardar.innerHTML = '<span class="spinner-border spinner-border-sm me-2"></span>Guardando ticket y subiendo fotos...';

    try {
        const numeroTicket = await generarSiguienteCorrelativo();

        // 1. Insertar registro principal en tabla tickets
        const { data: ticketCreado, error: errorTicket } = await supabaseClient
            .from('tickets')
            .insert([{
                numero_ticket: numeroTicket,
                tecnico_id: usuarioSesion.id,
                departamento_destino: departamento,
                equipo_referencia: equipo,
                tipo_falla: tipoFalla,
                descripcion_tarea: descripcion,
                estatus: estatus
            }])
            .select()
            .single();

        if (errorTicket) throw errorTicket;

        // 2. Subir fotografías (si existen) a Supabase Storage y registrar en ticket_fotos
        if (fotosSeleccionadas.length > 0) {
            const registrosFotos = [];

            for (let i = 0; i < fotosSeleccionadas.length; i++) {
                const fotoObj = fotosSeleccionadas[i];
                const nombreArchivo = `${numeroTicket}/${Date.now()}_foto_${i + 1}.jpg`;

                const { error: uploadError } = await supabaseClient.storage
                    .from(STORAGE_BUCKET)
                    .upload(nombreArchivo, fotoObj.blob, {
                        contentType: 'image/jpeg',
                        upsert: false
                    });

                if (uploadError) throw uploadError;

                const { data: publicUrlData } = supabaseClient.storage
                    .from(STORAGE_BUCKET)
                    .getPublicUrl(nombreArchivo);

                registrosFotos.push({
                    ticket_id: ticketCreado.id,
                    url_foto: publicUrlData.publicUrl,
                    ruta_storage: nombreArchivo,
                    orden: i + 1
                });
            }

            const { error: errorFotosDB } = await supabaseClient
                .from('ticket_fotos')
                .insert(registrosFotos);

            if (errorFotosDB) throw errorFotosDB;
        }

        // Limpiar formulario y reiniciar
        document.getElementById('formNuevoTicket').reset();
        fotosSeleccionadas.forEach(f => URL.revokeObjectURL(f.previewUrl));
        fotosSeleccionadas = [];
        renderizarMiniaturas();
        await generarSiguienteCorrelativo();
        await cargarTickets();

        if (typeof cargarEstadisticasCEDOCABAR === 'function' && usuarioSesion.rol === 'admin') {
            await cargarEstadisticasCEDOCABAR();
        }

        Swal.fire({
            icon: 'success',
            title: `Ticket ${numeroTicket} Generado`,
            text: 'La actividad y sus evidencias fotográficas fueron registradas correctamente.',
            confirmButtonColor: '#0b2545'
        });

    } catch (err) {
        console.error('Error guardando ticket:', err);
        Swal.fire({
            icon: 'error',
            title: 'Error al Guardar',
            text: err.message || 'Ocurrió un problema al registrar el ticket en Supabase.',
            confirmButtonColor: '#0b2545'
        });
    } finally {
        btnGuardar.disabled = false;
        btnGuardar.innerHTML = '<i class="bi bi-cloud-arrow-up-fill me-2"></i>Guardar Ticket y Evidencias';
    }
}

// Cargar historial de tickets (Admin ve todos; Técnico ve solo los suyos)
async function cargarTickets() {
    const contenedor = document.getElementById('listaTickets');
    contenedor.innerHTML = '<div class="text-center py-4 text-muted"><span class="spinner-border spinner-border-sm me-2"></span>Cargando tickets...</div>';

    try {
        let query = supabaseClient
            .from('tickets')
            .select(`
                *,
                tecnicos ( nombre_completo, usuario ),
                ticket_fotos ( id, url_foto, orden )
            `)
            .order('fecha_inicio', { ascending: false });

        if (usuarioSesion.rol !== 'admin') {
            query = query.eq('tecnico_id', usuarioSesion.id);
        }

        const { data, error } = await query;
        if (error) throw error;

        ticketsCache = data || [];
        aplicarFiltrosHistorial();
    } catch (err) {
        console.error(err);
        contenedor.innerHTML = '<div class="alert alert-danger small">Error al cargar el historial de tickets.</div>';
    }
}

// Evaluar todos los filtros combinados (Texto + Técnico + Estatus + Rango de Fechas)
function aplicarFiltrosHistorial() {
    const texto = (document.getElementById('buscarTicket')?.value || '').toLowerCase().trim();
    const tecnicoSel = document.getElementById('filtroTecnico')?.value || 'Todos';
    const estatusSel = document.getElementById('filtroEstatus')?.value || 'Todos';
    const fechaDesde = document.getElementById('filtroFechaDesde')?.value || '';
    const fechaHasta = document.getElementById('filtroFechaHasta')?.value || '';

    ticketsFiltradosActuales = ticketsCache.filter(t => {
        // 1. Filtro por texto
        const coincideTexto = !texto ||
            t.numero_ticket.toLowerCase().includes(texto) ||
            t.departamento_destino.toLowerCase().includes(texto) ||
            t.equipo_referencia.toLowerCase().includes(texto) ||
            t.tipo_falla.toLowerCase().includes(texto) ||
            (t.tecnicos && t.tecnicos.nombre_completo.toLowerCase().includes(texto));

        if (!coincideTexto) return false;

        // 2. Filtro por técnico específico (solo aplica si es admin y eligió uno)
        if (usuarioSesion.rol === 'admin' && tecnicoSel !== 'Todos' && t.tecnico_id !== tecnicoSel) {
            return false;
        }

        // 3. Filtro por estatus
        if (estatusSel !== 'Todos' && t.estatus !== estatusSel) {
            return false;
        }

        // 4. Filtro por rango de fechas (comparando fecha local YYYY-MM-DD)
        if (fechaDesde || fechaHasta) {
            const fechaTicketObj = new Date(t.fecha_inicio);
            const anio = fechaTicketObj.getFullYear();
            const mes = String(fechaTicketObj.getMonth() + 1).padStart(2, '0');
            const dia = String(fechaTicketObj.getDate()).padStart(2, '0');
            const fechaLocalStr = `${anio}-${mes}-${dia}`;

            if (fechaDesde && fechaLocalStr < fechaDesde) return false;
            if (fechaHasta && fechaLocalStr > fechaHasta) return false;
        }

        return true;
    });

    renderizarListaTickets(ticketsFiltradosActuales);
}

// Generar Reporte Consolidado Imprimible con Logo Oficial y Depto. de Gestión Tecnológica
function imprimirReporteConsolidado() {
    if (!ticketsFiltradosActuales || ticketsFiltradosActuales.length === 0) {
        Swal.fire({
            icon: 'info',
            title: 'Sin tickets para imprimir',
            text: 'No hay registros en la lista actual con los filtros aplicados.',
            confirmButtonColor: '#0b2545'
        });
        return;
    }

    const logoUrl = new URL('img/logo.png', window.location.href).href;
    const textoBusq = (document.getElementById('buscarTicket')?.value || '').trim();
    const tecnicoSelect = document.getElementById('filtroTecnico');
    const tecnicoTexto = (usuarioSesion.rol === 'admin' && tecnicoSelect && tecnicoSelect.value !== 'Todos')
        ? tecnicoSelect.options[tecnicoSelect.selectedIndex].text
        : (usuarioSesion.rol === 'admin' ? 'Todos los técnicos' : usuarioSesion.nombre_completo);
    const estatusTexto = document.getElementById('filtroEstatus')?.value || 'Todos';
    const fechaDesde = document.getElementById('filtroFechaDesde')?.value || '';
    const fechaHasta = document.getElementById('filtroFechaHasta')?.value || '';

    let rangoFechasTexto = 'Histórico completo';
    if (fechaDesde && fechaHasta) rangoFechasTexto = `Del ${fechaDesde} al ${fechaHasta}`;
    else if (fechaDesde) rangoFechasTexto = `Desde el ${fechaDesde}`;
    else if (fechaHasta) rangoFechasTexto = `Hasta el ${fechaHasta}`;

    const total = ticketsFiltradosActuales.length;
    const completados = ticketsFiltradosActuales.filter(t => t.estatus === 'Completado').length;
    const enProceso = ticketsFiltradosActuales.filter(t => t.estatus === 'En Proceso').length;
    const pendientes = ticketsFiltradosActuales.filter(t => t.estatus === 'Pendiente').length;

    const fechaEmision = new Date().toLocaleString('es-VE', {
        day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit'
    });

    const filasHTML = ticketsFiltradosActuales.map((t, index) => {
        const fechaReg = new Date(t.fecha_inicio).toLocaleDateString('es-VE', {
            day: '2-digit', month: '2-digit', year: 'numeric'
        });
        const nombreTec = t.tecnicos?.nombre_completo || 'N/A';
        const cantFotos = t.ticket_fotos ? t.ticket_fotos.length : 0;

        let claseEstatus = 'est-completado';
        if (t.estatus === 'En Proceso') claseEstatus = 'est-proceso';
        else if (t.estatus === 'Pendiente') claseEstatus = 'est-pendiente';

        return `
            <tr>
                <td class="text-center">${index + 1}</td>
                <td class="fw-bold nowrap">${t.numero_ticket}</td>
                <td class="nowrap">${fechaReg}</td>
                <td>${t.departamento_destino}</td>
                <td>${t.equipo_referencia}</td>
                <td>${t.tipo_falla}</td>
                <td>${nombreTec}</td>
                <td class="desc-col">${t.descripcion_tarea}</td>
                <td class="text-center">${cantFotos}/5</td>
                <td class="text-center"><span class="badge-est ${claseEstatus}">${t.estatus.toUpperCase()}</span></td>
            </tr>
        `;
    }).join('');

    const ventanaReporte = window.open('', '_blank', 'width=1100,height=800');
    ventanaReporte.document.write(`
        <!DOCTYPE html>
        <html lang="es">
        <head>
            <meta charset="UTF-8">
            <title>Reporte Consolidado de Soporte Técnico - CEDOCABAR</title>
            <style>
                @page { size: letter landscape; margin: 12mm; }
                * { box-sizing: border-box; font-family: 'Segoe UI', Arial, sans-serif; }
                body { margin: 0; padding: 0; color: #1e293b; background: #ffffff; }
                .cabecera {
                    background: linear-gradient(90deg, #061326 0%, #0b2545 65%, #134074 100%);
                    color: #ffffff;
                    padding: 12px 18px;
                    border-radius: 8px;
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                    margin-bottom: 12px;
                    -webkit-print-color-adjust: exact;
                    print-color-adjust: exact;
                }
                .cabecera-identidad {
                    display: flex;
                    align-items: center;
                    gap: 14px;
                }
                .cabecera-identidad img {
                    width: 58px;
                    height: 58px;
                    object-fit: contain;
                }
                .cabecera h1 { margin: 0; font-size: 19px; letter-spacing: 0.5px; }
                .cabecera p { margin: 2px 0 0; font-size: 11.5px; opacity: 0.9; }
                .meta-emision {
                    background: #ffffff;
                    color: #0b2545;
                    padding: 7px 12px;
                    border-radius: 6px;
                    text-align: right;
                    font-size: 11px;
                }
                .meta-emision strong { display: block; font-size: 12px; }
                .panel-filtros {
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                    background: #f8fafc;
                    border: 1px solid #cbd5e1;
                    border-radius: 6px;
                    padding: 8px 12px;
                    margin-bottom: 12px;
                    font-size: 11px;
                    -webkit-print-color-adjust: exact;
                    print-color-adjust: exact;
                }
                .resumen-kpis { display: flex; gap: 10px; }
                .kpi-pill {
                    padding: 3px 9px;
                    border-radius: 4px;
                    font-weight: 700;
                    font-size: 10.5px;
                    border: 1px solid #cbd5e1;
                    background: #ffffff;
                }
                table.reporte { width: 100%; border-collapse: collapse; font-size: 10.5px; }
                table.reporte thead th {
                    background-color: #0b2545;
                    color: #ffffff;
                    padding: 7px 6px;
                    text-align: left;
                    font-weight: 600;
                    border: 1px solid #0b2545;
                    -webkit-print-color-adjust: exact;
                    print-color-adjust: exact;
                }
                table.reporte tbody td { padding: 6px; border: 1px solid #cbd5e1; vertical-align: top; }
                table.reporte tbody tr:nth-child(even) {
                    background-color: #f8fafc;
                    -webkit-print-color-adjust: exact;
                    print-color-adjust: exact;
                }
                .text-center { text-align: center !important; }
                .fw-bold { font-weight: 700; color: #0b2545; }
                .nowrap { white-space: nowrap; }
                .desc-col { max-width: 240px; line-height: 1.35; }
                .badge-est {
                    display: inline-block;
                    padding: 2px 6px;
                    border-radius: 4px;
                    font-size: 9px;
                    font-weight: 700;
                    white-space: nowrap;
                    -webkit-print-color-adjust: exact;
                    print-color-adjust: exact;
                }
                .est-completado { background: #dcfce7; color: #166534; border: 1px solid #86efac; }
                .est-proceso { background: #fef9c3; color: #854d0e; border: 1px solid #fde047; }
                .est-pendiente { background: #fee2e2; color: #991b1b; border: 1px solid #fca5a5; }
                .firmas {
                    display: flex;
                    justify-content: space-around;
                    gap: 60px;
                    margin-top: 36px;
                    padding: 0 40px;
                    page-break-inside: avoid;
                }
                .firma-col { flex: 1; max-width: 280px; text-align: center; font-size: 11px; }
                .linea-firma { border-top: 1px solid #0b2545; padding-top: 4px; font-weight: 700; color: #0b2545; }
                .pie-pagina {
                    margin-top: 18px;
                    text-align: center;
                    font-size: 9.5px;
                    color: #64748b;
                    border-top: 1px dashed #cbd5e1;
                    padding-top: 6px;
                }
            </style>
        </head>
        <body>
            <div class="cabecera">
                <div class="cabecera-identidad">
                    <img src="${logoUrl}" alt="Logo CEDOCABAR">
                    <div>
                        <h1>CEDOCABAR</h1>
                        <p>Departamento de Gestión Tecnológica &bull; Reporte Consolidado de Actividades de Soporte Técnico</p>
                    </div>
                </div>
                <div class="meta-emision">
                    <strong>Emitido por: ${usuarioSesion.nombre_completo}</strong>
                    <span>Fecha de emisión: ${fechaEmision}</span>
                </div>
            </div>

            <div class="panel-filtros">
                <div>
                    <strong>Técnico:</strong> ${tecnicoTexto} &nbsp;|&nbsp;
                    <strong>Estatus:</strong> ${estatusTexto} &nbsp;|&nbsp;
                    <strong>Período:</strong> ${rangoFechasTexto}
                    ${textoBusq ? `&nbsp;|&nbsp; <strong>Filtro texto:</strong> "${textoBusq}"` : ''}
                </div>
                <div class="resumen-kpis">
                    <span class="kpi-pill" style="color:#0b2545;">Total: ${total}</span>
                    <span class="kpi-pill" style="color:#166534;">Completados: ${completados}</span>
                    <span class="kpi-pill" style="color:#854d0e;">En Proceso: ${enProceso}</span>
                    <span class="kpi-pill" style="color:#991b1b;">Pendientes: ${pendientes}</span>
                </div>
            </div>

            <table class="reporte">
                <thead>
                    <tr>
                        <th class="text-center" style="width: 28px;">#</th>
                        <th>N° Ticket</th>
                        <th>Fecha</th>
                        <th>Departamento</th>
                        <th>Equipo / Bien</th>
                        <th>Categoría / Falla</th>
                        <th>Técnico</th>
                        <th>Descripción de la Actividad</th>
                        <th class="text-center">Fotos</th>
                        <th class="text-center">Estatus</th>
                    </tr>
                </thead>
                <tbody>
                    ${filasHTML}
                </tbody>
            </table>

            <div class="firmas">
                <div class="firma-col">
                    <div class="linea-firma">Elaborado por</div>
                    <div>${usuarioSesion.nombre_completo}</div>
                    <div style="color:#64748b;">Dpto. Gestión Tecnológica - CEDOCABAR</div>
                </div>
                <div class="firma-col">
                    <div class="linea-firma">Conformidad / Jefatura de Gestión Tecnológica</div>
                    <div>Firma y Sello Institucional</div>
                    <div style="color:#64748b;">CEDOCABAR</div>
                </div>
            </div>

            <div class="pie-pagina">
                Reporte consolidado generado automáticamente por el Sistema de Control de Soporte Técnico CEDOCABAR
            </div>

            <script>
                window.onload = function() {
                    const imgs = Array.from(document.images);
                    if (imgs.length === 0) { window.print(); return; }
                    let cargadas = 0;
                    const verificar = () => {
                        cargadas++;
                        if (cargadas >= imgs.length) setTimeout(() => window.print(), 250);
                    };
                    imgs.forEach(img => {
                        if (img.complete) verificar();
                        else { img.onload = verificar; img.onerror = verificar; }
                    });
                };
            <\/script>
        </body>
        </html>
    `);
    ventanaReporte.document.close();
}

// Exportar tickets actualmente filtrados a archivo CSV compatible con Excel (UTF-8 BOM)
function exportarTicketsFiltradosCSV() {
    if (!ticketsFiltradosActuales || ticketsFiltradosActuales.length === 0) {
        Swal.fire({
            icon: 'info',
            title: 'Sin datos para exportar',
            text: 'No hay tickets en la lista actual con los filtros seleccionados.',
            confirmButtonColor: '#0b2545'
        });
        return;
    }

    const encabezados = [
        'N° Ticket',
        'Fecha Registro',
        'Fecha Cierre',
        'Técnico Responsable',
        'Departamento',
        'Equipo / Bien',
        'Tipo de Falla',
        'Estatus',
        'Descripción Tarea',
        'Observaciones de Cierre',
        'Cant. Fotos'
    ];

    const escaparCelda = (valor) => {
        if (valor === null || valor === undefined) return '""';
        const textoLimpio = String(valor).replace(/"/g, '""').replace(/\r?\n/g, ' ');
        return `"${textoLimpio}"`;
    };

    const filas = ticketsFiltradosActuales.map(t => {
        const fechaReg = t.fecha_inicio
            ? new Date(t.fecha_inicio).toLocaleString('es-VE', {
                day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit'
            })
            : '';
        const fechaCie = (t.fecha_cierre && t.estatus === 'Completado')
            ? new Date(t.fecha_cierre).toLocaleString('es-VE', {
                day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit'
            })
            : '';
        const tecnicoNombre = t.tecnicos?.nombre_completo || 'N/A';
        const cantFotos = t.ticket_fotos ? t.ticket_fotos.length : 0;

        return [
            escaparCelda(t.numero_ticket),
            escaparCelda(fechaReg),
            escaparCelda(fechaCie),
            escaparCelda(tecnicoNombre),
            escaparCelda(t.departamento_destino),
            escaparCelda(t.equipo_referencia),
            escaparCelda(t.tipo_falla),
            escaparCelda(t.estatus),
            escaparCelda(t.descripcion_tarea),
            escaparCelda(t.observaciones_cierre || ''),
            escaparCelda(cantFotos)
        ].join(';');
    });

    const contenidoCSV = '\uFEFF' + [encabezados.join(';'), ...filas].join('\r\n');
    const blob = new Blob([contenidoCSV], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);

    const hoy = new Date().toISOString().slice(0, 10);
    const enlace = document.createElement('a');
    enlace.href = url;
    enlace.download = `Soporte_CEDOCABAR_${hoy}.csv`;
    document.body.appendChild(enlace);
    enlace.click();
    document.body.removeChild(enlace);
    URL.revokeObjectURL(url);
}

function renderizarListaTickets(lista) {
    const contenedor = document.getElementById('listaTickets');
    const contadorLbl = document.getElementById('contadorResultadosHistorial');

    if (contadorLbl) {
        contadorLbl.textContent = `Mostrando ${lista.length} de ${ticketsCache.length} ticket(s)`;
    }

    if (!lista.length) {
        contenedor.innerHTML = `
            <div class="text-center py-4 text-muted small">
                <i class="bi bi-funnel d-block fs-4 mb-1"></i>
                No se encontraron tickets con los filtros aplicados.
            </div>
        `;
        return;
    }

    contenedor.innerHTML = lista.map(t => {
        const fecha = new Date(t.fecha_inicio).toLocaleString('es-VE', {
            day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit'
        });
        const badgeColor = t.estatus === 'Completado'
            ? 'bg-success'
            : (t.estatus === 'En Proceso' ? 'bg-warning text-dark' : 'bg-danger');
        const cantFotos = t.ticket_fotos ? t.ticket_fotos.length : 0;
        const nombreTec = t.tecnicos ? t.tecnicos.nombre_completo : 'N/A';

        return `
            <div class="card ticket-card shadow-sm border-0 bg-light p-3" onclick="verDetalleTicket('${t.id}')" style="cursor:pointer;">
                <div class="d-flex justify-content-between align-items-start mb-1">
                    <span class="fw-bold" style="color: #0b2545;">${t.numero_ticket}</span>
                    <span class="badge ${badgeColor}">${t.estatus}</span>
                </div>
                <div class="small fw-semibold text-dark">${t.departamento_destino} &bull; <span class="text-primary">${t.equipo_referencia}</span></div>
                <p class="small text-muted text-truncate mb-2">${t.descripcion_tarea}</p>
                <div class="d-flex justify-content-between align-items-center border-top pt-2" style="font-size: 0.75rem;">
                    <span class="text-secondary"><i class="bi bi-person-fill"></i> ${nombreTec}</span>
                    <span>
                        <span class="badge bg-secondary me-1"><i class="bi bi-camera"></i> ${cantFotos}/5</span>
                        <span class="text-muted">${fecha}</span>
                    </span>
                </div>
            </div>
        `;
    }).join('');
}

// Mostrar Modal con detalle, cambio de estatus, fotos adicionales (hasta 5 totales) y galería
window.verDetalleTicket = function(ticketId) {
    const ticket = ticketsCache.find(t => t.id === ticketId);
    if (!ticket) return;

    // Reiniciar buffer de fotos adicionales al abrir el modal
    fotosAdicionalesCierre.forEach(f => URL.revokeObjectURL(f.previewUrl));
    fotosAdicionalesCierre = [];

    const btnImprimir = document.getElementById('btnImprimirOrden');
    if (btnImprimir) {
        btnImprimir.onclick = () => imprimirOrdenServicio(ticket.id);
    }

    document.getElementById('modalTicketTitulo').textContent = `${ticket.numero_ticket} - ${ticket.tipo_falla}`;

    const fechaInicio = new Date(ticket.fecha_inicio).toLocaleString('es-VE');
    const fechaCierre = ticket.fecha_cierre ? new Date(ticket.fecha_cierre).toLocaleString('es-VE') : 'Sin fecha de cierre';
    const fotosOrdenadas = (ticket.ticket_fotos || []).sort((a, b) => a.orden - b.orden);
    const cupoRestante = MAX_FOTOS - fotosOrdenadas.length;

    const badgeColor = ticket.estatus === 'Completado'
        ? 'bg-success'
        : (ticket.estatus === 'En Proceso' ? 'bg-warning text-dark' : 'bg-danger');

    // Bloque de fotografías ya guardadas
    let htmlFotos = '<p class="text-muted small fst-italic">Este ticket no tiene fotografías adjuntas.</p>';
    if (fotosOrdenadas.length > 0) {
        htmlFotos = `
            <div class="row g-2">
                ${fotosOrdenadas.map(f => `
                    <div class="col-6 col-md-4">
                        <a href="${f.url_foto}" target="_blank" rel="noopener">
                            <img src="${f.url_foto}" class="img-fluid rounded-3 border shadow-sm" style="height: 140px; width: 100%; object-fit: cover;" alt="Evidencia ${f.orden}">
                        </a>
                    </div>
                `).join('')}
            </div>
            <small class="text-muted d-block mt-1"><i class="bi bi-zoom-in"></i> Toque una imagen para verla en tamaño completo.</small>
        `;
    }

    // Bloque de observaciones previas (si existen)
    let htmlObservacionesGuardadas = '';
    if (ticket.observaciones_cierre) {
        htmlObservacionesGuardadas = `
            <div class="p-3 rounded-3 border border-success bg-success bg-opacity-10 mb-3">
                <div class="d-flex justify-content-between align-items-center mb-1">
                    <strong class="small text-success"><i class="bi bi-check-circle-fill me-1"></i> Observaciones de Seguimiento / Cierre:</strong>
                    <small class="text-muted" style="font-size: 0.72rem;">${fechaCierre}</small>
                </div>
                <p class="small mb-0 text-dark" style="white-space: pre-line;">${ticket.observaciones_cierre}</p>
            </div>
        `;
    }

    // Sección de subida de fotos adicionales dentro del cierre (si aún no llega a 5)
    let htmlSubidaAdicional = '';
    if (cupoRestante > 0) {
        htmlSubidaAdicional = `
            <div class="col-12 mt-2">
                <div class="p-2 rounded-3 border bg-white">
                    <div class="d-flex justify-content-between align-items-center mb-1">
                        <label class="form-label small fw-bold mb-0" style="color: #0b2545;">
                            <i class="bi bi-camera-fill me-1"></i> Adjuntar Evidencias de Cierre
                        </label>
                        <span class="badge bg-primary" id="contadorFotosCierre">${fotosOrdenadas.length} / ${MAX_FOTOS} totales</span>
                    </div>
                    <small class="text-muted d-block mb-2" style="font-size: 0.75rem;">
                        Puede agregar hasta <strong>${cupoRestante}</strong> fotografía(s) adicional(es) para completar el límite de 5.
                    </small>
                    <div class="d-flex gap-2 flex-wrap">
                        <label class="btn btn-outline-primary btn-sm rounded-3 py-1" id="lblCamaraCierre">
                            <i class="bi bi-camera me-1"></i> Tomar Foto
                            <input type="file" id="inputCamaraCierre" accept="image/*" capture="environment" class="d-none">
                        </label>
                        <label class="btn btn-outline-secondary btn-sm rounded-3 py-1" id="lblGaleriaCierre">
                            <i class="bi bi-images me-1"></i> Galería
                            <input type="file" id="inputGaleriaCierre" accept="image/*" multiple class="d-none">
                        </label>
                    </div>
                    <div id="miniaturasCierre" class="d-flex flex-wrap gap-2 mt-2"></div>
                </div>
            </div>
        `;
    } else {
        htmlSubidaAdicional = `
            <div class="col-12 mt-1">
                <small class="text-muted fst-italic"><i class="bi bi-info-circle"></i> Este ticket ya alcanzó el máximo de 5 fotografías permitidas.</small>
            </div>
        `;
    }

    // Formulario de actualización de estatus si NO está Completado (o si el admin desea editarlo)
    let htmlControlEstatus = '';
    if (ticket.estatus !== 'Completado' || usuarioSesion.rol === 'admin') {
        htmlControlEstatus = `
            <div class="p-3 rounded-3 border mb-3" style="background-color: #f4f7fb; border-color: #134074 !important;">
                <h6 class="fw-bold small mb-2" style="color: #0b2545;">
                    <i class="bi bi-arrow-repeat me-1"></i> Actualizar Estatus y Observaciones de Cierre
                </h6>
                <div class="row g-2">
                    <div class="col-12 col-md-5">
                        <label class="form-label small fw-semibold text-secondary mb-1">Nuevo Estatus</label>
                        <select class="form-select form-select-sm" id="selectNuevoEstatus">
                            <option value="En Proceso" ${ticket.estatus === 'En Proceso' ? 'selected' : ''}>En Proceso</option>
                            <option value="Pendiente" ${ticket.estatus === 'Pendiente' ? 'selected' : ''}>Pendiente</option>
                            <option value="Completado" ${ticket.estatus === 'Completado' ? 'selected' : ''}>Completado</option>
                        </select>
                    </div>
                    <div class="col-12">
                        <label class="form-label small fw-semibold text-secondary mb-1">Observaciones de Cierre / Seguimiento *</label>
                        <textarea class="form-control form-control-sm" id="txtObservacionesCierre" rows="2" placeholder="Indique la solución aplicada, repuesto instalado o motivo de actualización...">${ticket.observaciones_cierre || ''}</textarea>
                    </div>
                    ${htmlSubidaAdicional}
                    <div class="col-12 text-end mt-2">
                        <button type="button" class="btn btn-navy btn-sm rounded-3 px-3" id="btnGuardarEstatusTicket" onclick="actualizarEstatusTicket('${ticket.id}')">
                            <i class="bi bi-check2-circle me-1"></i> Guardar Actualización
                        </button>
                    </div>
                </div>
            </div>
        `;
    }

    document.getElementById('modalTicketCuerpo').innerHTML = `
        <div class="d-flex justify-content-between align-items-center mb-3 pb-2 border-bottom">
            <span class="small text-muted">Estado actual del soporte:</span>
            <span class="badge ${badgeColor} px-3 py-1">${ticket.estatus.toUpperCase()}</span>
        </div>

        <div class="mb-3">
            <div class="row g-2 small">
                <div class="col-6"><strong>Departamento:</strong><br>${ticket.departamento_destino}</div>
                <div class="col-6"><strong>Equipo / Bien:</strong><br>${ticket.equipo_referencia}</div>
                <div class="col-6"><strong>Técnico Responsable:</strong><br>${ticket.tecnicos?.nombre_completo || 'N/A'}</div>
                <div class="col-6"><strong>Fecha de Registro:</strong><br>${fechaInicio}</div>
            </div>
        </div>

        <div class="p-3 bg-light rounded-3 border mb-3">
            <strong class="small d-block mb-1" style="color:#0b2545;">Descripción Inicial de la Tarea:</strong>
            <p class="small mb-0" style="white-space: pre-line;">${ticket.descripcion_tarea}</p>
        </div>

        ${htmlObservacionesGuardadas}
        ${htmlControlEstatus}

        <div>
            <strong class="small d-block mb-2" style="color:#0b2545;">Evidencias Fotográficas Guardadas (${fotosOrdenadas.length}/5):</strong>
            ${htmlFotos}
        </div>
    `;

    // Vincular eventos de cámara/galería del cierre si existe cupo
    if (cupoRestante > 0 && (ticket.estatus !== 'Completado' || usuarioSesion.rol === 'admin')) {
        const inpCam = document.getElementById('inputCamaraCierre');
        const inpGal = document.getElementById('inputGaleriaCierre');
        if (inpCam) inpCam.addEventListener('change', (e) => manejarFotosCierre(e, fotosOrdenadas.length));
        if (inpGal) inpGal.addEventListener('change', (e) => manejarFotosCierre(e, fotosOrdenadas.length));
    }

    const modalEl = document.getElementById('modalDetalleTicket');
    const modal = bootstrap.Modal.getOrCreateInstance(modalEl);
    modal.show();
};

// Procesar fotos adicionales en el modal respetando el máximo de 5 totales
async function manejarFotosCierre(e, cantidadExistente) {
    const archivos = Array.from(e.target.files);
    if (!archivos.length) return;

    const cupoDisponible = MAX_FOTOS - (cantidadExistente + fotosAdicionalesCierre.length);
    if (cupoDisponible <= 0) {
        Swal.fire({
            icon: 'warning',
            title: 'Límite alcanzado',
            text: 'No puede superar el máximo de 5 fotografías totales en el ticket.',
            confirmButtonColor: '#0b2545'
        });
        e.target.value = '';
        return;
    }

    let listaProcesar = archivos;
    if (archivos.length > cupoDisponible) {
        Swal.fire({
            icon: 'info',
            title: 'Cupo limitado',
            text: `Solo se agregarán ${cupoDisponible} foto(s) para completar el máximo de 5.`,
            confirmButtonColor: '#0b2545'
        });
        listaProcesar = archivos.slice(0, cupoDisponible);
    }

    for (const archivo of listaProcesar) {
        if (!archivo.type.startsWith('image/')) continue;
        try {
            const comprimida = await comprimirImagen(archivo);
            fotosAdicionalesCierre.push(comprimida);
        } catch (err) {
            console.error('Error comprimiendo foto de cierre:', err);
        }
    }

    e.target.value = '';
    renderizarMiniaturasCierre(cantidadExistente);
}

function renderizarMiniaturasCierre(cantidadExistente) {
    const contenedor = document.getElementById('miniaturasCierre');
    const contador = document.getElementById('contadorFotosCierre');
    const lblCam = document.getElementById('lblCamaraCierre');
    const lblGal = document.getElementById('lblGaleriaCierre');

    if (!contenedor) return;

    const totalActual = cantidadExistente + fotosAdicionalesCierre.length;
    contador.textContent = `${totalActual} / ${MAX_FOTOS} totales`;

    const lleno = totalActual >= MAX_FOTOS;
    if (lblCam) lblCam.classList.toggle('disabled', lleno);
    if (lblGal) lblGal.classList.toggle('disabled', lleno);

    contenedor.innerHTML = '';
    fotosAdicionalesCierre.forEach((item, idx) => {
        const box = document.createElement('div');
        box.className = 'photo-preview-box';
        box.innerHTML = `
            <img src="${item.previewUrl}" alt="Nueva evidencia ${idx + 1}">
            <button type="button" class="btn btn-danger btn-remove-photo" onclick="eliminarFotoCierre(${idx}, ${cantidadExistente})" title="Quitar foto">
                <i class="bi bi-x"></i>
            </button>
        `;
        contenedor.appendChild(box);
    });
}

window.eliminarFotoCierre = function(index, cantidadExistente) {
    URL.revokeObjectURL(fotosAdicionalesCierre[index].previewUrl);
    fotosAdicionalesCierre.splice(index, 1);
    renderizarMiniaturasCierre(cantidadExistente);
};

// Guardar cambio de estatus, observaciones y subir fotografías adicionales
window.actualizarEstatusTicket = async function(ticketId) {
    const ticket = ticketsCache.find(t => t.id === ticketId);
    if (!ticket) return;

    const nuevoEstatus = document.getElementById('selectNuevoEstatus').value;
    const observaciones = document.getElementById('txtObservacionesCierre').value.trim();

    if (nuevoEstatus === 'Completado' && !observaciones) {
        Swal.fire({
            icon: 'warning',
            title: 'Observación requerida',
            text: 'Debe escribir las observaciones de cierre antes de marcar el ticket como Completado.',
            confirmButtonColor: '#0b2545'
        });
        return;
    }

    const btn = document.getElementById('btnGuardarEstatusTicket');
    btn.disabled = true;
    btn.innerHTML = '<span class="spinner-border spinner-border-sm me-1"></span>Guardando...';

    try {
        // 1. Subir fotografías adicionales si el técnico seleccionó nuevas
        if (fotosAdicionalesCierre.length > 0) {
            const fotosActuales = ticket.ticket_fotos || [];
            const ordenBase = fotosActuales.length > 0
                ? Math.max(...fotosActuales.map(f => f.orden || 0))
                : 0;

            const nuevosRegistros = [];

            for (let i = 0; i < fotosAdicionalesCierre.length; i++) {
                const fotoObj = fotosAdicionalesCierre[i];
                const numeroOrden = ordenBase + i + 1;
                const nombreArchivo = `${ticket.numero_ticket}/${Date.now()}_cierre_${numeroOrden}.jpg`;

                const { error: uploadError } = await supabaseClient.storage
                    .from(STORAGE_BUCKET)
                    .upload(nombreArchivo, fotoObj.blob, {
                        contentType: 'image/jpeg',
                        upsert: false
                    });

                if (uploadError) throw uploadError;

                const { data: publicUrlData } = supabaseClient.storage
                    .from(STORAGE_BUCKET)
                    .getPublicUrl(nombreArchivo);

                nuevosRegistros.push({
                    ticket_id: ticket.id,
                    url_foto: publicUrlData.publicUrl,
                    ruta_storage: nombreArchivo,
                    orden: numeroOrden
                });
            }

            const { error: errorInsertFotos } = await supabaseClient
                .from('ticket_fotos')
                .insert(nuevosRegistros);

            if (errorInsertFotos) throw errorInsertFotos;
        }

        // 2. Actualizar estatus y observaciones de cierre
        const datosActualizar = {
            estatus: nuevoEstatus,
            observaciones_cierre: observaciones || null
        };

        if (nuevoEstatus === 'Completado') {
            datosActualizar.fecha_cierre = new Date().toISOString();
        }

        const { error } = await supabaseClient
            .from('tickets')
            .update(datosActualizar)
            .eq('id', ticketId);

        if (error) throw error;

        // Limpiar buffer temporal
        fotosAdicionalesCierre.forEach(f => URL.revokeObjectURL(f.previewUrl));
        fotosAdicionalesCierre = [];

        // Recargar lista y estadísticas
        await cargarTickets();
        if (typeof cargarEstadisticasCEDOCABAR === 'function' && usuarioSesion.rol === 'admin') {
            await cargarEstadisticasCEDOCABAR();
        }

        // Volver a renderizar el modal actualizado con las nuevas fotos incluidas
        verDetalleTicket(ticketId);

        Swal.fire({
            icon: 'success',
            title: 'Ticket Actualizado',
            text: `Estatus actualizado a "${nuevoEstatus}" y evidencias guardadas.`,
            timer: 1600,
            showConfirmButton: false
        });

    } catch (err) {
        console.error('Error actualizando ticket:', err);
        Swal.fire({
            icon: 'error',
            title: 'Error al Actualizar',
            text: err.message || 'No se pudo actualizar el ticket.',
            confirmButtonColor: '#0b2545'
        });
    } finally {
        if (btn) {
            btn.disabled = false;
            btn.innerHTML = '<i class="bi bi-check2-circle me-1"></i> Guardar Actualización';
        }
    }
};

// Generar Orden de Servicio Imprimible / PDF Institucional CEDOCABAR
window.imprimirOrdenServicio = function(ticketId) {
    const ticket = ticketsCache.find(t => t.id === ticketId);
    if (!ticket) return;

    const logoUrl = new URL('img/logo.png', window.location.href).href;
    const fecha = new Date(ticket.fecha_inicio).toLocaleString('es-VE', {
        day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit'
    });
    const fechaCierre = ticket.fecha_cierre
        ? new Date(ticket.fecha_cierre).toLocaleString('es-VE', {
            day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit'
        })
        : null;
    const fechaEmision = new Date().toLocaleDateString('es-VE');
    const nombreTecnico = ticket.tecnicos?.nombre_completo || 'No especificado';
    const fotosOrdenadas = (ticket.ticket_fotos || []).sort((a, b) => a.orden - b.orden);

    let seccionObservacionesHTML = '';
    if (ticket.observaciones_cierre) {
        seccionObservacionesHTML = `
            <div class="seccion">
                <div class="seccion-titulo">OBSERVACIONES DE CIERRE / SEGUIMIENTO ${fechaCierre && ticket.estatus === 'Completado' ? `(CERRADO EL ${fechaCierre})` : ''}</div>
                <div class="descripcion-texto">${ticket.observaciones_cierre}</div>
            </div>
        `;
    }

    let seccionFotosHTML = '';
    if (fotosOrdenadas.length > 0) {
        seccionFotosHTML = `
            <div class="seccion">
                <div class="seccion-titulo">REGISTRO FOTOGRÁFICO DE SOPORTE (${fotosOrdenadas.length} EVIDENCIA${fotosOrdenadas.length > 1 ? 'S' : ''})</div>
                <div class="grid-fotos">
                    ${fotosOrdenadas.map(f => `
                        <div class="foto-item">
                            <img src="${f.url_foto}" alt="Evidencia ${f.orden}">
                            <span>Evidencia #${f.orden}</span>
                        </div>
                    `).join('')}
                </div>
            </div>
        `;
    }

    const ventanaImpresion = window.open('', '_blank', 'width=900,height=750');
    ventanaImpresion.document.write(`
        <!DOCTYPE html>
        <html lang="es">
        <head>
            <meta charset="UTF-8">
            <title>Orden de Servicio ${ticket.numero_ticket} - CEDOCABAR</title>
            <style>
                @page { size: letter; margin: 14mm; }
                * { box-sizing: border-box; font-family: 'Segoe UI', Arial, sans-serif; }
                body { margin: 0; padding: 0; color: #1e293b; background: #ffffff; }
                .cabecera {
                    background: linear-gradient(90deg, #061326 0%, #0b2545 65%, #134074 100%);
                    color: #ffffff;
                    padding: 14px 20px;
                    border-radius: 8px;
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                    margin-bottom: 16px;
                    -webkit-print-color-adjust: exact;
                    print-color-adjust: exact;
                }
                .cabecera-identidad {
                    display: flex;
                    align-items: center;
                    gap: 14px;
                }
                .cabecera-identidad img {
                    width: 62px;
                    height: 62px;
                    object-fit: contain;
                }
                .cabecera h1 { margin: 0; font-size: 20px; letter-spacing: 0.5px; }
                .cabecera p { margin: 2px 0 0; font-size: 12px; opacity: 0.9; }
                .ticket-box {
                    background: #ffffff;
                    color: #0b2545;
                    padding: 8px 14px;
                    border-radius: 6px;
                    text-align: right;
                    font-weight: bold;
                }
                .ticket-box small { display: block; font-size: 10px; color: #475569; text-transform: uppercase; }
                .ticket-box span { font-size: 15px; }
                .seccion { border: 1px solid #cbd5e1; border-radius: 6px; margin-bottom: 14px; overflow: hidden; }
                .seccion-titulo {
                    background-color: #f1f5f9;
                    color: #0b2545;
                    font-weight: 700;
                    font-size: 11px;
                    padding: 7px 12px;
                    border-bottom: 1px solid #cbd5e1;
                    letter-spacing: 0.4px;
                    -webkit-print-color-adjust: exact;
                    print-color-adjust: exact;
                }
                table.datos { width: 100%; border-collapse: collapse; font-size: 12px; }
                table.datos td { padding: 8px 12px; border-bottom: 1px solid #e2e8f0; width: 50%; }
                table.datos tr:last-child td { border-bottom: none; }
                .label { font-weight: 700; color: #334155; display: block; font-size: 10px; text-transform: uppercase; margin-bottom: 2px; }
                .descripcion-texto { padding: 12px; font-size: 12.5px; line-height: 1.5; white-space: pre-line; min-height: 55px; }
                .grid-fotos { display: grid; grid-template-columns: repeat(3, 1fr); gap: 10px; padding: 12px; }
                .foto-item { border: 1px solid #cbd5e1; border-radius: 5px; padding: 5px; text-align: center; page-break-inside: avoid; }
                .foto-item img { width: 100%; height: 145px; object-fit: cover; border-radius: 3px; display: block; }
                .foto-item span { display: block; font-size: 10px; color: #475569; margin-top: 4px; font-weight: 600; }
                .firmas { display: flex; justify-content: space-between; gap: 40px; margin-top: 38px; padding: 0 20px; page-break-inside: avoid; }
                .firma-col { flex: 1; text-align: center; font-size: 11px; }
                .linea-firma { border-top: 1px solid #0b2545; margin-bottom: 6px; padding-top: 4px; font-weight: bold; color: #0b2545; }
                .pie-pagina { margin-top: 22px; text-align: center; font-size: 10px; color: #64748b; border-top: 1px dashed #cbd5e1; padding-top: 8px; }
            </style>
        </head>
        <body>
            <div class="cabecera">
                <div class="cabecera-identidad">
                    <img src="${logoUrl}" alt="Logo CEDOCABAR">
                    <div>
                        <h1>CEDOCABAR</h1>
                        <p>Departamento de Gestión Tecnológica &bull; Orden de Servicio de Soporte Técnico</p>
                    </div>
                </div>
                <div class="ticket-box">
                    <small>N° de Control</small>
                    <span>${ticket.numero_ticket}</span>
                </div>
            </div>

            <div class="seccion">
                <div class="seccion-titulo">INFORMACIÓN GENERAL DEL SERVICIO</div>
                <table class="datos">
                    <tr>
                        <td>
                            <span class="label">Departamento / Unidad Atendida</span>
                            ${ticket.departamento_destino}
                        </td>
                        <td>
                            <span class="label">Equipo / Código de Bien o Serial</span>
                            ${ticket.equipo_referencia}
                        </td>
                    </tr>
                    <tr>
                        <td>
                            <span class="label">Técnico Responsable</span>
                            ${nombreTecnico}
                        </td>
                        <td>
                            <span class="label">Fecha y Hora de Registro</span>
                            ${fecha}
                        </td>
                    </tr>
                    <tr>
                        <td>
                            <span class="label">Categoría / Tipo de Falla</span>
                            ${ticket.tipo_falla}
                        </td>
                        <td>
                            <span class="label">Estatus Final del Ticket</span>
                            <strong>${ticket.estatus.toUpperCase()}</strong>
                        </td>
                    </tr>
                </table>
            </div>

            <div class="seccion">
                <div class="seccion-titulo">DESCRIPCIÓN DE LA TAREA Y DIAGNÓSTICO INICIAL</div>
                <div class="descripcion-texto">${ticket.descripcion_tarea}</div>
            </div>

            ${seccionObservacionesHTML}
            ${seccionFotosHTML}

            <div class="firmas">
                <div class="firma-col">
                    <div class="linea-firma">Técnico de Soporte</div>
                    <div>${nombreTecnico}</div>
                    <div style="color:#64748b;">Dpto. Gestión Tecnológica - CEDOCABAR</div>
                </div>
                <div class="firma-col">
                    <div class="linea-firma">Recibido Conforme (Unidad Atendida)</div>
                    <div>Nombre y Cédula: ______________________</div>
                    <div style="color:#64748b;">Sello / Firma del Departamento</div>
                </div>
            </div>

            <div class="pie-pagina">
                Documento generado el ${fechaEmision} &bull; Sistema de Control de Soporte Técnico CEDOCABAR
            </div>

            <script>
                window.onload = function() {
                    const imgs = Array.from(document.images);
                    if (imgs.length === 0) { window.print(); return; }
                    let cargadas = 0;
                    const verificar = () => {
                        cargadas++;
                        if (cargadas >= imgs.length) setTimeout(() => window.print(), 250);
                    };
                    imgs.forEach(img => {
                        if (img.complete) verificar();
                        else { img.onload = verificar; img.onerror = verificar; }
                    });
                };
            <\/script>
        </body>
        </html>
    `);
    ventanaImpresion.document.close();
};