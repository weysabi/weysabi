import type { BaseLayoutProps } from "fumadocs-ui/layouts/shared";
import { Logo } from "@/components/logo";

export function baseOptions(): BaseLayoutProps {
  return {
    nav: {
      title: <Logo className="h-7" />,
      url: "/",
    },
    links: [
      { text: "Documentation", url: "/docs", active: "nested-url" },
      { text: "Admin", url: "/admin" },
      {
        text: "GitHub",
        url: "https://github.com/weysabi/sabi",
        external: true,
      },
    ],
    githubUrl: "https://github.com/weysabi/sabi",
  };
}
