/**
 * Is this a deployment, or somebody's laptop?
 *
 * The developer tools write hundreds of fake records and empty tables. Getting
 * that wrong once, on a real database, is the kind of mistake a package is
 * remembered for - so the question is asked at start-up and answered
 * conservatively.
 *
 * **`NODE_ENV` is a hint, not the check.** Staging runs as production, plenty of
 * deployments never set it, and a build that shipped with `NODE_ENV=development`
 * baked into a container would sail past it. The platform variables are far
 * harder to be wrong about: nothing sets `KUBERNETES_SERVICE_HOST` on a laptop.
 *
 * Being wrong in the safe direction costs one line of configuration -
 * `allowInProduction: true` - and says so in the error. Being wrong in the
 * other direction costs somebody their data.
 */

/**
 * Variables that only exist on a hosting platform.
 *
 * Presence is the signal; the value is not read. Each is documented by its
 * platform as always set for a running application.
 */
const PLATFORM_VARIABLES = [
  'VERCEL', // Vercel
  'RENDER', // Render
  'FLY_APP_NAME', // Fly.io
  'RAILWAY_ENVIRONMENT', // Railway
  'DYNO', // Heroku
  'K_SERVICE', // Google Cloud Run
  'WEBSITE_INSTANCE_ID', // Azure App Service
  'AWS_EXECUTION_ENV', // AWS Lambda and friends
  'AWS_LAMBDA_FUNCTION_NAME',
  'KUBERNETES_SERVICE_HOST', // any Kubernetes pod
  'CF_PAGES', // Cloudflare Pages
  'DENO_DEPLOYMENT_ID',
] as const

export interface DeploymentSignal {
  readonly deployed: boolean
  /** What said so, for a message that can be acted on rather than argued with. */
  readonly because: readonly string[]
}

export function deploymentSignal(environment: NodeJS.ProcessEnv = process.env): DeploymentSignal {
  const because: string[] = []

  if (environment['NODE_ENV'] === 'production') because.push('NODE_ENV=production')

  for (const name of PLATFORM_VARIABLES) {
    if (environment[name] !== undefined && environment[name] !== '') because.push(name)
  }

  return { deployed: because.length > 0, because }
}
