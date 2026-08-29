/**
 * Placeholder shell.
 *
 * The real admin - resource list, record table, create/edit forms, pagination,
 * search - is not implemented. When it is, this component will fetch the model
 * metadata exposed by the NestJS integration and render resources generically.
 * It must never learn which ORM is behind that API.
 */
export function App() {
  return (
    <main className="shell">
      <h1>Nest Admin</h1>
      <p>
        Foundation only. The admin interface is not implemented yet — no resource discovery, no CRUD
        screens.
      </p>
    </main>
  )
}
