# ClinCoord Mental v1.3 – Etapa 5

Esta versión conecta la app con Supabase como base de datos real.

## Qué hace

- Login real con Supabase Auth.
- Lee `profiles`, `professionals`, `patients`, `patient_team`, `medications`, `clozapine_programs`, `lai_programs`, `alerts`, `trace_events`, `messages` y `files`.
- Respeta las políticas RLS creadas en Supabase: administrador ve su institución completa; profesionales ven solo pacientes asignados.
- Mantiene modo claro/oscuro, vista móvil/web, exportación CSV, programa clozapina e inyectables.

## Importante

Antes de usarla debes haber ejecutado en Supabase las etapas SQL 5.1, 5.2, 5.3 y 5.4.

No uses pacientes reales hasta probar seguridad, respaldo y flujos de edición.
