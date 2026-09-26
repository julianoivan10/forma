"use client";

import "@rainbow-me/rainbowkit/styles.css";

import { lightTheme, RainbowKitProvider } from "@rainbow-me/rainbowkit";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState, type ReactNode } from "react";
import { WagmiProvider } from "wagmi";

import { TxProvider } from "@/lib/tx";
import { wagmiConfig } from "@/lib/wagmi";

const theme = {
  ...lightTheme({
    accentColor: "#0e1a2b",
    accentColorForeground: "#f3efe4",
    borderRadius: "none",
    overlayBlur: "none",
  }),
};
theme.fonts.body = "var(--font-instrument), ui-sans-serif, system-ui, sans-serif";
theme.colors.modalBackground = "#f9f7f0";
theme.colors.modalBorder = "#0e1a2b";
theme.shadows.dialog = "none";

export function Providers({ children }: { children: ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: { staleTime: 2_000, retry: 2, refetchOnWindowFocus: true },
        },
      }),
  );
  return (
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={queryClient}>
        <RainbowKitProvider theme={theme} modalSize="compact" appInfo={{ appName: "Forma · Base Sepolia testnet" }}>
          <TxProvider>{children}</TxProvider>
        </RainbowKitProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}
