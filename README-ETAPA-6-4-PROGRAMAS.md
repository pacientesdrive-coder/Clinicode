# Etapa 6.4 - Programas clínicos reales

Esta versión agrega formularios reales conectados a Supabase para:

- Programa Clozapina: dosis, esquema, fecha de inicio, último hemograma, próximo hemograma, periodicidad, leucocitos, neutrófilos, estado, responsable y notas.
- Inyectables de depósito / LAI: fármaco, dosis, vía, intervalo, última administración, próxima administración, sitio, estado, responsable y notas.

Los cambios quedan guardados en Supabase y generan trazabilidad básica en `trace_events`.

Antes de usar datos reales, probar con pacientes ficticios y confirmar que los permisos por RLS siguen funcionando.
