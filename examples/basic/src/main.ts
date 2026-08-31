import 'reflect-metadata'

import { NestFactory } from '@nestjs/core'

import { AppModule } from './app.module'

/**
 * Read `.env`, if this Node can and if there is one.
 *
 * `process.loadEnvFile` arrived in Node 20.12; the package's floor is 20.11,
 * so it is called through a guard rather than assumed. No dotenv: an example
 * that needs a dependency to read one variable is teaching the wrong lesson,
 * and on an older Node exporting `ADMIN_SESSION_SECRET` in the shell works
 * just as well.
 */
function loadEnv(): void {
  const load = (process as NodeJS.Process & { loadEnvFile?: (path?: string) => void }).loadEnvFile
  if (typeof load !== 'function') return

  try {
    load('.env')
  } catch {
    // No .env, which is fine - the variables may already be in the
    // environment, and app.module.ts says so clearly if the secret is missing.
  }
}

async function bootstrap() {
  loadEnv()
  const app = await NestFactory.create(AppModule)
  await app.listen(5000)
}

void bootstrap()
