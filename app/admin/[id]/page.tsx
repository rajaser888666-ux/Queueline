import type { Metadata } from "next";
import { AdminApp } from "./AdminApp";

export const metadata: Metadata = { title: "Admin", robots: { index: false, follow: false }, referrer: "no-referrer" };

export default async function AdminPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <AdminApp id={id} />;
}
