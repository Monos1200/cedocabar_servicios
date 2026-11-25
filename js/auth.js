// js/auth.js
document.addEventListener('DOMContentLoaded', () => {
    // Ocultar preloader
    setTimeout(() => {
        const preloader = document.getElementById('preloader');
        if (preloader) preloader.classList.add('hidden');
    }, 500);

    // Si ya hay sesión activa, redirigir al dashboard
    const sesionActual = localStorage.getItem('cedocabar_sesion');
    if (sesionActual && window.location.pathname.endsWith('index.html') || (sesionActual && window.location.pathname.endsWith('/'))) {
        window.location.href = 'dashboard.html';
        return;
    }

    // Limpiar inputs por seguridad
    const inputUsuario = document.getElementById('usuario');
    const inputClave = document.getElementById('clave');
    if (inputUsuario) inputUsuario.value = '';
    if (inputClave) inputClave.value = '';

    // Mostrar / Ocultar contraseña
    const toggleClave = document.getElementById('toggleClave');
    if (toggleClave) {
        toggleClave.addEventListener('click', () => {
            const icono = document.getElementById('iconoClave');
            if (inputClave.type === 'password') {
                inputClave.type = 'text';
                icono.classList.replace('bi-eye', 'bi-eye-slash');
            } else {
                inputClave.type = 'password';
                icono.classList.replace('bi-eye-slash', 'bi-eye');
            }
        });
    }

    // Envío del formulario de Login
    const formLogin = document.getElementById('formLogin');
    if (formLogin) {
        formLogin.addEventListener('submit', async (e) => {
            e.preventDefault();
            const usuario = inputUsuario.value.trim();
            const clave = inputClave.value.trim();
            const btnIngresar = document.getElementById('btnIngresar');

            btnIngresar.disabled = true;
            btnIngresar.innerHTML = '<span class="spinner-border spinner-border-sm me-2"></span>Verificando...';

            try {
                const { data, error } = await supabaseClient
                    .from('tecnicos')
                    .select('id, cedula, nombre_completo, usuario, rol, activo')
                    .eq('usuario', usuario)
                    .eq('clave', clave)
                    .maybeSingle();

                if (error) throw error;

                if (!data) {
                    Swal.fire({
                        icon: 'error',
                        title: 'Acceso Denegado',
                        text: 'Usuario o contraseña incorrectos.',
                        confirmButtonColor: '#0b2545'
                    });
                    return;
                }

                if (!data.activo) {
                    Swal.fire({
                        icon: 'warning',
                        title: 'Cuenta Inactiva',
                        text: 'Su usuario se encuentra deshabilitado. Contacte al administrador de CEDOCABAR.',
                        confirmButtonColor: '#0b2545'
                    });
                    return;
                }

                // Guardar sesión
                localStorage.setItem('cedocabar_sesion', JSON.stringify(data));

                Swal.fire({
                    icon: 'success',
                    title: `¡Bienvenido, ${data.nombre_completo}!`,
                    text: 'Ingresando al panel de soporte...',
                    timer: 1200,
                    showConfirmButton: false
                }).then(() => {
                    window.location.href = 'dashboard.html';
                });

            } catch (err) {
                console.error(err);
                Swal.fire({
                    icon: 'error',
                    title: 'Error de Conexión',
                    text: 'No se pudo conectar con Supabase. Verifique su conexión a internet.',
                    confirmButtonColor: '#0b2545'
                });
            } finally {
                btnIngresar.disabled = false;
                btnIngresar.innerHTML = '<i class="bi bi-box-arrow-in-right me-2"></i>Iniciar Sesión';
            }
        });
    }
});

// Registro de Service Worker y Prompt de instalación PWA
if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(err => console.warn('SW error:', err));
}

let deferredPrompt;
window.addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    deferredPrompt = e;
    const container = document.getElementById('pwaInstallContainer');
    if (container) container.classList.remove('d-none');
});

const btnInstallPWA = document.getElementById('btnInstallPWA');
if (btnInstallPWA) {
    btnInstallPWA.addEventListener('click', async () => {
        if (!deferredPrompt) return;
        deferredPrompt.prompt();
        await deferredPrompt.userChoice;
        deferredPrompt = null;
        document.getElementById('pwaInstallContainer').classList.add('d-none');
    });
}