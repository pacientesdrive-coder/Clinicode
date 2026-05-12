# ClinCoord Mental — Etapa 4: Login real con Supabase

Esta versión mantiene la demo completa, pero agrega una puerta de login real con Supabase Auth.

## 1. Instalar dependencias

Abre `cmd` dentro de esta carpeta y ejecuta:

```bash
npm install
```

## 2. Crear archivo .env.local

Copia `.env.example` y renómbralo a:

```text
.env.local
```

Dentro pega tus valores de Supabase:

```text
VITE_SUPABASE_URL=...
VITE_SUPABASE_ANON_KEY=...
```

## 3. Probar local

```bash
npm run dev
```

Abre la URL que aparezca, normalmente:

```text
http://localhost:5173/
```

## 4. Usuarios demo sugeridos

Crea estos usuarios en Supabase Auth para probar permisos:

- admin@clincoord.demo → administrador centro médico
- valentina@clincoord.demo → profesional centro médico p1
- andres@clincoord.demo → profesional centro médico p2
- camila@clincoord.demo → profesional centro médico p3
- roberto@clincoord.demo → profesional centro médico p4
- h-admin@clincoord.demo → administrador hospital
- h-valentina@clincoord.demo → profesional hospital p1_h
- h-andres@clincoord.demo → profesional hospital p2_h

La contraseña puede ser la que tú definas en Supabase. Usa una contraseña de prueba, no una personal.

## 5. Importante

Esto es una etapa intermedia. El login ya es real, pero los pacientes siguen siendo mock/datos ficticios dentro del frontend.

La seguridad clínica real exige que los pacientes vivan en base de datos y que las reglas de acceso se apliquen con Row Level Security / backend, no solo en React.
