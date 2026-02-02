'use client';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { BookOpen, Settings, List } from 'lucide-react';

export default function Navbar() {
    const pathname = usePathname();

    const links = [
        { href: '/', label: 'Dashboard', icon: BookOpen },
        { href: '/journals', label: 'Journals', icon: List },
        { href: '/settings', label: 'Settings', icon: Settings },
    ];

    return (
        <nav className="border-b border-border bg-card/80 backdrop-blur-sm sticky top-0 z-50">
            <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
                <div className="flex justify-between h-16">
                    <div className="flex">
                        <div className="flex-shrink-0 flex items-center">
                            <span className="text-xl font-bold bg-gradient-to-r from-primary to-blue-400 bg-clip-text text-transparent">
                                JournalMonitor
                            </span>
                        </div>
                        <div className="hidden sm:ml-6 sm:flex sm:space-x-8">
                            {links.map((link) => {
                                const Icon = link.icon;
                                const isActive = pathname === link.href;
                                return (
                                    <Link
                                        key={link.href}
                                        href={link.href}
                                        className={`inline-flex items-center px-1 pt-1 border-b-2 text-sm font-medium transition-colors ${isActive
                                                ? 'border-primary text-foreground'
                                                : 'border-transparent text-muted-foreground hover:text-foreground hover:border-gray-300'
                                            }`}
                                    >
                                        <Icon className="w-4 h-4 mr-2" />
                                        {link.label}
                                    </Link>
                                );
                            })}
                        </div>
                    </div>
                </div>
            </div>
        </nav>
    );
}
