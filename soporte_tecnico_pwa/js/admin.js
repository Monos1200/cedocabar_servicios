// js/admin.js
let chartTecnicosInstance = null;
let chartFallasInstance = null;

document.addEventListener('DOMContentLoaded', async () => {
    const rawSesion = localStorage.getItem('cedocabar_sesion');
    if (!rawSesion) return;
    const sesion = JSON.parse(rawSesion);

    if (sesion.rol !== 'admin') return;

    // Mostrar pestaña de estadísticas para el administrador
    const navStats = document.getElementById('navItemEstadisticas');
    if (navStats) navStats.classList.remove('d-none');

    await cargarTablaTecnicos();
    await cargarEstadisticasCEDOCABAR();

    // Actualizar gráficos al abrir la pestaña o pulsar el botón de refresco
    const tabStatsBtn = document.getElementById('tab-estadisticas-btn');
    if (tabStatsBtn) {
        tabStatsBtn.addEventListener('shown.bs.tab', cargarEstadisticasCEDOCABAR);
    }
    const btnRefrescarStats = document.getElementById('btnRefrescarStats');
    if (btnRefrescarStats) {
        btnRefrescarStats.addEventListener('click', cargarEstadisticasCEDOCABAR);
    }

    const formNuevoTecnico = document.getElementById('formNuevoTecnico');
    if (formNuevoTecnico) {
        formNuevoTecnico.addEventListener('submit', async (e) => {
            e.preventDefault();
            const cedula = document.getElementById('tec_cedula').value.trim();
            const nombre_completo = document.getElementById('tec_nombre').value.trim();
            const rol = document.getElementById('tec_rol').value;
            const usuario = document.getElementById('tec_usuario').value.trim();
            const clave = document.getElementById('tec_clave').value.trim();

            try {
                const { error } = await supabaseClient
                    .from('tecnicos')
                    .insert([{ cedula, nombre_completo, rol, usuario, clave, activo: true }]);

                if (error) throw error;

                formNuevoTecnico.reset();
                await cargarTablaTecnicos();
                Swal.fire({
                    icon: 'success',
                    title: 'Usuario Creado',
                    text: `El técnico ${nombre_completo} ya puede iniciar sesión.`,
                    confirmButtonColor: '#0b2545'
                });
            } catch (err) {
                console.error(err);
                Swal.fire({
                    icon: 'error',
                    title: 'Error',
                    text: 'No se pudo registrar el técnico (verifique que la cédula o usuario no estén repetidos).',
                    confirmButtonColor: '#0b2545'
                });
            }
        });
    }
});

async function cargarTablaTecnicos() {
    const tbody = document.getElementById('tablaTecnicosBody');
    if (!tbody) return;

    try {
        const { data, error } = await supabaseClient
            .from('tecnicos')
            .select('*')
            .order('nombre_completo', { ascending: true });

        if (error) throw error;

        tbody.innerHTML = data.map(tec => `
            <tr>
                <td>
                    <div class="fw-semibold">${tec.nombre_completo}</div>
                    <small class="text-muted">${tec.cedula}</small>
                </td>
                <td><code>${tec.usuario}</code></td>
                <td><span class="badge ${tec.rol === 'admin' ? 'bg-primary' : 'bg-secondary'}">${tec.rol}</span></td>
                <td class="text-center">
                    <button class="btn btn-sm ${tec.activo ? 'btn-success' : 'btn-outline-danger'} py-0 px-2"
                            onclick="cambiarEstadoTecnico('${tec.id}', ${!tec.activo})">
                        ${tec.activo ? 'Activo' : 'Inactivo'}
                    </button>
                </td>
            </tr>
        `).join('');

        // Sincronizar el selector desplegable de técnicos en la pestaña Historial
        if (typeof cargarSelectorFiltroTecnicos === 'function') {
            await cargarSelectorFiltroTecnicos();
        }
    } catch (err) {
        console.error('Error cargando técnicos:', err);
    }
}

window.cambiarEstadoTecnico = async function(id, nuevoEstado) {
    try {
        const { error } = await supabaseClient
            .from('tecnicos')
            .update({ activo: nuevoEstado })
            .eq('id', id);

        if (error) throw error;
        await cargarTablaTecnicos();
    } catch (err) {
        Swal.fire('Error', 'No se pudo cambiar el estado del técnico.', 'error');
    }
};

// Consultar datos y renderizar gráficos con Chart.js
async function cargarEstadisticasCEDOCABAR() {
    try {
        const { data: tickets, error } = await supabaseClient
            .from('tickets')
            .select(`
                id,
                tipo_falla,
                estatus,
                tecnicos ( nombre_completo )
            `);

        if (error) throw error;
        const lista = tickets || [];

        // 1. Actualizar KPIs superiores
        const total = lista.length;
        const completados = lista.filter(t => t.estatus === 'Completado').length;
        const pendientes = total - completados;

        document.getElementById('kpiTotalTickets').textContent = total;
        document.getElementById('kpiCompletados').textContent = completados;
        document.getElementById('kpiPendientes').textContent = pendientes;

        // 2. Agrupar cantidad de tickets por técnico
        const conteoTecnicos = {};
        lista.forEach(t => {
            const nombre = t.tecnicos?.nombre_completo || 'Sin asignar';
            conteoTecnicos[nombre] = (conteoTecnicos[nombre] || 0) + 1;
        });

        const tecnicosOrdenados = Object.entries(conteoTecnicos).sort((a, b) => b[1] - a[1]);
        const labelsTecnicos = tecnicosOrdenados.map(item => item[0]);
        const datosTecnicos = tecnicosOrdenados.map(item => item[1]);

        // 3. Agrupar fallas más frecuentes
        const conteoFallas = {};
        lista.forEach(t => {
            const falla = t.tipo_falla || 'Otros';
            conteoFallas[falla] = (conteoFallas[falla] || 0) + 1;
        });

        const fallasOrdenadas = Object.entries(conteoFallas).sort((a, b) => b[1] - a[1]);
        const labelsFallas = fallasOrdenadas.map(item => item[0]);
        const datosFallas = fallasOrdenadas.map(item => item[1]);

        renderizarGraficoTecnicos(labelsTecnicos, datosTecnicos);
        renderizarGraficoFallas(labelsFallas, datosFallas);

    } catch (err) {
        console.error('Error cargando estadísticas:', err);
    }
}

function renderizarGraficoTecnicos(labels, valores) {
    const ctx = document.getElementById('graficoTicketsTecnico');
    if (!ctx) return;

    if (chartTecnicosInstance) {
        chartTecnicosInstance.destroy();
    }

    chartTecnicosInstance = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: labels,
            datasets: [{
                label: 'Tickets Atendidos',
                data: valores,
                backgroundColor: '#134074',
                borderColor: '#061326',
                borderWidth: 1,
                borderRadius: 6
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false }
            },
            scales: {
                y: {
                    beginAtZero: true,
                    ticks: { stepSize: 1, precision: 0 }
                }
            }
        }
    });
}

function renderizarGraficoFallas(labels, valores) {
    const ctx = document.getElementById('graficoFallasFrecuentes');
    if (!ctx) return;

    if (chartFallasInstance) {
        chartFallasInstance.destroy();
    }

    chartFallasInstance = new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels: labels,
            datasets: [{
                data: valores,
                backgroundColor: [
                    '#061326',
                    '#0b2545',
                    '#134074',
                    '#1d63b8',
                    '#4a90e2',
                    '#8da9c4'
                ],
                borderWidth: 2,
                borderColor: '#ffffff'
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: {
                    position: 'bottom',
                    labels: {
                        boxWidth: 12,
                        font: { size: 11 }
                    }
                }
            }
        }
    });
}