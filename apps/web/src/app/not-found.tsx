import Link from "next/link";

export default function NotFound() {
  return (
    <section className="py-24">
      <p className="label">404</p>
      <h1 className="display mt-4 text-6xl">No such object.</h1>
      <p className="mt-4 max-w-prose text-ink-2">This page does not exist in the Forma interface.</p>
      <Link href="/" className="btn mt-8">Back to Forma</Link>
    </section>
  );
}
