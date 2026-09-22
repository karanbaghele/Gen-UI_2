"use client";
import { useParams } from "next/navigation";
import { DashboardEditor } from "@/components/dashboard-editor";
export default function DashboardPage() {
  const params = useParams<{ id: string }>();
  return <DashboardEditor id={params.id} />;
}
