# ClinCoord Mental v1.4 — Etapa 6.1 a 6.3

Esta versión agrega formularios reales conectados a Supabase para:

- crear pacientes nuevos desde la app;
- editar datos clínico-administrativos básicos;
- asignar equipo tratante desde la app;
- registrar trazabilidad básica de creación/edición.

## Uso recomendado

1. Copia tu `.env.local` desde la versión anterior.
2. Ejecuta `npm install`.
3. Ejecuta `npm run dev`.
4. Entra como `admin@clincoord.demo`.
5. Ve a Pacientes y prueba `+ Nuevo paciente` con datos falsos.
6. Asígnale un profesional del equipo.
7. Cierra sesión y entra como ese profesional para verificar que el paciente aparece solo para él.

## Nota de seguridad

En esta versión solo el administrador puede crear pacientes y reasignar equipo tratante. Los profesionales pueden editar los pacientes que ya tienen asignados.

No usar pacientes reales hasta terminar pruebas de seguridad y respaldo.
