import { notFound } from "next/navigation";

/** The /dev scratch routes exist for local development only. */
export default function DevLayout({ children }: LayoutProps<"/dev">) {
  if (process.env.NODE_ENV === "production") notFound();
  return children;
}
