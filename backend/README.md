# REST API para exponer datos de bases de datos

Este proyecto implementa **REST API con TypeScript** usando [Express](https://expressjs.com/) y [Prisma Client](https://www.prisma.io/docs/concepts/components/prisma-client). Este ejemplo usa PostgreSQL como motor de base de datos, aunque es posible utilizarlo con otros tipos de base de datos.

## ¿Cómo arrancar?

### 1. Download example and install dependencies

Instalar las dependencias con npm:

```
npm install
```

### 2. Crear y llenar la DB

Configura `DATABASE_URL` en tu `.env` o en las variables de entorno del servicio.

Ejemplo de URL para PostgreSQL:

```env
DATABASE_URL="postgresql://user:password@localhost:5432/flock_archive"
```

Luego ejecuta la migración y el seed:

```
npx prisma migrate dev --name init
```

Esto aplicará el esquema de [`prisma/schema.prisma`](./prisma/schema.prisma) y llenará la base de datos de prueba usando [`prisma/seed.ts`](./prisma/seed.ts).

-------------------

También es posible empujar el esquema directamente sin crear nuevas migraciones:

```
npx prisma db push
```

### 3. Iniciar el servidor REST API

```
npm run dev
```

El servidor ahora se encuentra corriendo `http://localhost:3000`. Puede realizar la primera petición, ejem. [`http://localhost:3000/`](http://localhost:3000/).

## Usando la REST API

Estos son los endpoints de la API:

### `GET`

- `/`: Root del aplicativo
- `/contaminantes`: Devuelve los contaminantes

### `POST`

- `/calados`: Guardar un nuevo calado
  - Body:
    - `fechaHora: String` (required): La fecha y hora en la que se realiza el calado. Formato ISO 8601 (ej. "2024-01-01T00:00:00Z").
    - `turnoSistemaPlaya: Int` (required): El identificador del turno en el sistema de playa.
    - `trabajoTurnoId: Int` (required): El identificador del turno de trabajo asociado.
    - `caladosOk: Int` (required): El número de calados que fueron exitosos.
    - `caladosNok: Int` (required): El número de calados que no fueron exitosos.
    - `calle: Int` (required): El número de la calle donde se realizó el calado.
    - `estrategia: Int` (required): El identificador de la estrategia utilizada.
    - `formaCalado: Boolean` (optional): La forma en que se realizó el calado.
    - `modoContingencia: Boolean` (required): El modo de contingencia en que se operó.
    - `nivelVasos: Int` (required): El nivel de los vasos durante el calado.
    - `recalados: Int` (required): El número de recalados que se realizaron.
    - `tiempoInicio: String` (required): La fecha y hora de inicio del calado. Formato ISO 8601 (ej. "2024-01-01T00:00:00Z").
    - `tiempoFin: String` (required): La fecha y hora de finalización del calado. Formato ISO 8601 (ej. "2024-01-01T00:00:00Z").
    - `tipoCamion: Int` (required): El tipo de camión utilizado en el calado.
    - `productoId: Int` (required): El identificador del producto involucrado.
    - `username: String` (required): El nombre de usuario del que realiza la acción.
    - `profundidades: Array` (required): Una lista de objetos que representan las profundidades medidas durante el calado.
      - `nivel: Int` (required): El nivel correspondiente a la profundidad medida.
      - `valor: Int` (required): El valor de la profundidad en unidades adecuadas.


## Instalar la app como servicio de Windows

```
@echo off
chcp 65001

SET NRSPATH=C:\IEASRL\boquilleo
SET NODEJSPATH=%LIBPATH%\nodejs
SET STORAGEPATH=%NRSPATH%\storage
SET BINPATH=%NRSPATH%bin
SET NSSMPATH=%LIBPATH%\nssm
SET PATH=%PATH%;%NODEJSPATH%
SET NODE_PATH=%NODEJSPATH%
SET ServiceName=IeasrlBoquilleoApiRest

nssm install %ServiceName% %NODEJSPATH%\node-red.cmd
nssm set %ServiceName% AppDirectory %NODEJSPATH%
nssm set %ServiceName% DisplayName %ServiceName% 
nssm set %ServiceName% Description %ServiceDescriptionName%  
nssm set %ServiceName% AppStdout %NODEJSPATH%\logs\access.log
nssm set %ServiceName% AppStderr %NODEJSPATH%\logs\error.log
nssm set %ServiceName% AppEnvironmentExtra NRSPATH=%NRSPATH%
nssm set %ServiceName% AppStdoutCreationDisposition 4
nssm set %ServiceName% AppStderrCreationDisposition 4
nssm set %ServiceName% AppRotateFiles 1
nssm set %ServiceName% AppRotateOnline 0
nssm set %ServiceName% AppRotateSeconds 86400
nssm set %ServiceName% AppRotateBytes 1048576
nssm set %ServiceName% Start SERVICE_AUTO_START
```
