// js/supabase-config.js
const SUPABASE_URL = 'https://xswtmfpirgadlsrkqmgp.supabase.co';
const SUPABASE_ANON_KEY = 'sb_publishable_0ZCEw8BcIc_4QW-3lFlFHg_enMDcLOM';

// Inicialización del cliente global
const supabaseClient = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// Nombre del bucket de almacenamiento en Supabase Storage
const STORAGE_BUCKET = 'evidencias-soporte';