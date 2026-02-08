import { NextResponse } from 'next/server';
import { PrismaClient } from '@prisma/client';
import { auth } from '@/lib/auth/server';
import axios from 'axios';

const prisma = new PrismaClient();

// Validate ISSN and get journal info from CrossRef
async function validateIssn(issn: string): Promise<{ valid: boolean; title?: string; issn?: string }> {
    try {
        const response = await axios.get(`https://api.crossref.org/journals/${issn}`, {
            headers: {
                'User-Agent': `JournalMonitor/1.0 (mailto:${process.env.CROSSREF_CONTACT_EMAIL || 'test@test.com'})`
            },
            timeout: 10000
        });

        const journalData = response.data?.message;
        if (journalData && journalData.title) {
            return {
                valid: true,
                title: journalData.title,
                issn: issn
            };
        }
        return { valid: false };
    } catch (error) {
        return { valid: false };
    }
}

export async function POST(request: Request) {
    // Get current user
    const { data: session } = await auth.getSession();
    if (!session?.user) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    try {
        const body = await request.json();
        const { issn } = body;

        if (!issn || typeof issn !== 'string') {
            return NextResponse.json({ error: 'ISSN is required' }, { status: 400 });
        }

        // Clean ISSN (remove spaces, dashes variations)
        const cleanIssn = issn.trim().replace(/[\s]/g, '');

        // Check if journal already exists
        const existing = await prisma.journal.findFirst({
            where: {
                OR: [
                    { printIssn: cleanIssn },
                    { eIssn: cleanIssn }
                ]
            }
        });

        if (existing) {
            return NextResponse.json({
                success: true,
                journal: existing,
                message: 'Journal already exists in database'
            });
        }

        // Validate with CrossRef
        const validation = await validateIssn(cleanIssn);

        if (!validation.valid) {
            return NextResponse.json({
                error: 'Invalid ISSN or journal not found in CrossRef'
            }, { status: 404 });
        }

        // Create new custom journal
        const newJournal = await prisma.journal.create({
            data: {
                title: validation.title!,
                printIssn: cleanIssn,
                eIssn: null,
                ajgRanking: null,
                domain: 'Custom',
                isFt50: false,
                isUtd24: false,
                isCustom: true
            }
        });

        return NextResponse.json({
            success: true,
            journal: newJournal,
            message: 'Journal added successfully'
        });

    } catch (error) {
        console.error('Error adding custom journal:', error);
        return NextResponse.json({ error: 'Failed to add journal' }, { status: 500 });
    }
}
