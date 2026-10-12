export default function App() {
  return (
    <>
      <a className="skip-link" href="#console">Skip to console</a>
      <main id="console" className="mx-auto max-w-5xl px-6 py-12">
        <header className="mb-8 border-b border-slate-600 pb-6">
          <p className="mb-2 text-sm uppercase tracking-widest text-cyan-300">Tactical Space Battle</p>
          <h1 className="text-4xl font-semibold">Shadow-Dancer</h1>
          <p className="mt-3 text-slate-300">Command console · M0 scaffold</p>
        </header>
        <section aria-labelledby="console-status" className="rounded-lg border border-slate-600 bg-slate-900 p-6">
          <h2 id="console-status" className="text-xl font-semibold">Console scaffold ready</h2>
          <p className="mt-3 text-slate-300">The application shell is running. Scenario loading and gameplay are not implemented yet.</p>
          <details className="mt-6">
            <summary className="cursor-pointer text-cyan-300">About timed turns</summary>
            <p className="mt-3 max-w-2xl text-slate-300">The planned encounter uses simultaneous timed turns: plan orders, commit, watch execution, then assess. This scaffold does not simulate those phases.</p>
          </details>
        </section>
      </main>
    </>
  )
}
