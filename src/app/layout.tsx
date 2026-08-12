import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import CommandPalette from "@/components/CommandPalette";
import NavBar from "@/components/NavBar";
import QuickAddTask from "@/components/QuickAddTask";
import QuickAddEvent from "@/components/QuickAddEvent";
import CameraCapture from "@/components/CameraCapture";
import VideoSnapshot from "@/components/VideoSnapshot";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "VoiceData",
  description: "Talk to build a database on the fly.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <NavBar />
        {children}
        <CommandPalette />
        <QuickAddTask />
        <QuickAddEvent />
        <CameraCapture />
        <VideoSnapshot />
      </body>
    </html>
  );
}
