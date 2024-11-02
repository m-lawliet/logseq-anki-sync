import {Note} from "./Note";
import "@logseq/libs";
import _ from "lodash";
import {convertToHTMLFile, HTMLFile} from "../logseq/LogseqToHtmlConverter";
import {escapeClozesAndMacroDelimiters, safeReplace} from "../utils/utils";
import {ANKI_CLOZE_REGEXP, MD_PROPERTIES_REGEXP} from "../constants";
import {LogseqProxy} from "../logseq/LogseqProxy";
import type {BlockEntity, BlockUUID} from "@logseq/libs/dist/LSPlugin.user";
import {DependencyEntity} from "../logseq/getLogseqContentDirectDependencies";
import getUUIDFromBlock from "../logseq/getUUIDFromBlock";
import {NoteUtils} from "./NoteUtils";

type ExtendedBlockEntity = BlockEntity & {
    tagsFromParentCardGroup?: string[];
    parent?: {
        id: number;
    };
    refs?: Array<{id: number}>;
    children?: ExtendedBlockEntity[];
};

export class MultilineCardNote extends Note {
    public type = "multiline_card";
    public children: ExtendedBlockEntity[];
    public tags: string[];
    public constructor(
        uuid: string,
        content: string,
        format: string,
        properties: Record<string, any>,
        page: any,
        tags: string[] = [],
        children: ExtendedBlockEntity[] = [],
        tagIds: number[] = [],
    ) {
        super(uuid, content, format, properties, page, tagIds);
        this.children = children;
        this.tags = tags;
    }

    public static initLogseqOperations = () => {
        // Basic card templates
        logseq.Editor.registerSlashCommand("Card (Forward)", [
            ["editor/input", `#card #forward\nanki-model:: Basic\nanki-field-Front:: content\nanki-field-Back:: children`],
            ["editor/clear-current-slash"],
        ]);
        logseq.Editor.registerSlashCommand("Card (Reversed)", [
            ["editor/input", `#card #reversed\nanki-model:: Basic (and reversed card)\nanki-field-Front:: content\nanki-field-Back:: children`],
            ["editor/clear-current-slash"],
        ]);
        logseq.Editor.registerSlashCommand("Card (Bidirectional)", [
            ["editor/input", `#card #bidirectional\nanki-model:: Basic (and reversed card)\nanki-field-Front:: content\nanki-field-Back:: children`],
            ["editor/clear-current-slash"],
        ]);
        logseq.Editor.registerSlashCommand("Card (Incremental)", [
            ["editor/input", `#card #incremental\nanki-model:: Cloze\nanki-field-Text:: content`],
            ["editor/clear-current-slash"],
        ]);

        // Custom card templates
        logseq.Editor.registerSlashCommand("Card (Guitar Chord)", [
            ["editor/input", `#card
anki-model:: Guitar Chord
anki-field-Front:: content
anki-field-Chord:: chord-data
anki-field-ChordOptions:: chord-options
chord-data:: {"name":"","chord":[],"position":0,"barres":[]}
chord-options:: {"defaultColor":"#222","width":180,"height":210,"showTuning":true}`],
            ["editor/clear-current-slash"],
        ]);
        logseq.Editor.registerSlashCommand("Card (Code)", [
            ["editor/input", `#card
anki-model:: Code
anki-field-Front:: content
anki-field-Code:: code
anki-field-Language:: language
language:: javascript`],
            ["editor/clear-current-slash"],
        ]);
        logseq.Editor.registerSlashCommand("Card (Math)", [
            ["editor/input", `#card
anki-model:: Math
anki-field-Front:: content
anki-field-Math:: math
anki-field-Steps:: steps`],
            ["editor/clear-current-slash"],
        ]);

        // Style for page references
        logseq.provideStyle(`
            .page-reference[data-ref=flashcard], a[data-ref=flashcard] {
                opacity: .3;
            }
            .page-reference[data-ref=forward], a[data-ref=forward] {
                opacity: .3;
            }
            .page-reference[data-ref=reversed], a[data-ref=reversed] {
                opacity: .3;
            }
            .page-reference[data-ref=bidirectional], a[data-ref=bidirectional] {
                opacity: .3;
            }
            .page-reference[data-ref=incremental], a[data-ref=incremental] {
                opacity: .3;
            }
            .page-reference[data-ref^=depth-], a[data-ref^=depth-] {
                opacity: .3;
            }
            .page-reference[data-ref=card-group], a[data-ref=card-group] {
                opacity: .3;
            }
        `);

        // Create required pages
        LogseqProxy.Editor.createPageSilentlyIfNotExists("card-group");
        LogseqProxy.Editor.createPageSilentlyIfNotExists("flashcard");
        LogseqProxy.Editor.createPageSilentlyIfNotExists("forward");
        LogseqProxy.Editor.createPageSilentlyIfNotExists("reversed");
        LogseqProxy.Editor.createPageSilentlyIfNotExists("bidirectional");
        LogseqProxy.Editor.createPageSilentlyIfNotExists("incremental");
        for (let i = 1; i <= 9; i++) {
            LogseqProxy.Editor.createPageSilentlyIfNotExists(`depth-${i}`);
        }
    };

    private getCardDirection(): string {
        const direction = _.get(this, "properties.direction") as string;
        if (direction !== "->" && direction !== "<-" && direction !== "<->") {
            if (
                (this.tags.includes("reversed") && this.tags.includes("forward")) ||
                this.tags.includes("bidirectional")
            )
                return "<->";
            else if (this.tags.includes("reversed")) return "<-";
            else return "->";
        }
        return direction;
    }

    private getChildrenMaxDepth(): number {
        let maxDepth = _.get(this, "properties.depth") || 9999;
        for (const tag of this.tags) {
            const match = /^depth-(\d+)$/i.exec(tag);
            if (match) {
                maxDepth = parseInt(match[1]);
            }
        }
        return maxDepth;
    }

    private static async getRelevantTags(tagIds: number[]): Promise<string[]> {
        const tags = await NoteUtils.matchTagNamesWithTagIds(tagIds, [
            "forward",
            "reversed",
            "bidirectional",
            "incremental",
            ...Array.from({length: 10}, (_, i) => `depth-${i}`),
        ]);
        // Convert String[] to string[]
        return tags.map(tag => String(tag));
    }

    private async getFieldContent(fieldMapping: string): Promise<string> {
        // Handle special field mappings
        switch (fieldMapping) {
            case 'content':
                const contentHtml = await convertToHTMLFile(this.content, this.format);
                return contentHtml.html;
            case 'children':
                const childrenHtml = await this.getChildrenContent();
                return childrenHtml;
            default:
                // Check if it's a property value
                if (this.properties[fieldMapping]) {
                    return this.properties[fieldMapping].toString();
                }
                return '';
        }
    }

    private async getChildrenContent(): Promise<string> {
        const maxDepth = this.getChildrenMaxDepth();
        
        const getChildrenListHTML = async (
            childrenList: ExtendedBlockEntity[],
            level = 0,
        ): Promise<string> => {
            if (level >= maxDepth) return "";
            let childrenListHTML = `\n<ul class="children-list left-border">`;
            for (const child of childrenList) {
                childrenListHTML += `\n<li class="children ${_.get(child, "properties['logseq.orderListType']") == "number" ? 'numbered' : ''}">`;
                const childContent = _.get(child, "content", "");
                let sanitizedChildContent = escapeClozesAndMacroDelimiters(childContent);
                const childExtra = _.get(child, "properties.extra");
                if (childExtra) {
                    sanitizedChildContent += `\n<div class="extra">${childExtra}</div>`;
                }
                const sanitizedChildHTMLFile = await convertToHTMLFile(
                    sanitizedChildContent,
                    child.format,
                );
                let sanitizedChildHTML = sanitizedChildHTMLFile.html;
                
                if (child.children?.length > 0) {
                    sanitizedChildHTML += await getChildrenListHTML(child.children, level + 1);
                }
                childrenListHTML += sanitizedChildHTML;
                childrenListHTML += `</li>`;
            }
            childrenListHTML += `</ul>`;
            return childrenListHTML;
        };

        return await getChildrenListHTML(this.children);
    }

    public async getClozedContentHTML(): Promise<HTMLFile> {
        const assets = new Set<string>();
        const tags: string[] = [];

        // Get field content based on mappings
        const fieldContent: Record<string, string> = {};
        for (const [key, value] of Object.entries(this.properties)) {
            if (key.startsWith("anki-field-")) {
                const fieldName = key.replace("anki-field-", "");
                const mapping = value as string;
                fieldContent[fieldName] = await this.getFieldContent(mapping);
            }
        }

        // Get main content
        let mainContent: string;
        const direction = this.getCardDirection();
        if (direction === "<-" || direction === "<->") {
            // For reversed cards, swap content and children
            mainContent = await this.getFieldContent("children");
        } else {
            mainContent = await this.getFieldContent("content");
        }

        // If no fields specified, use defaults based on model type
        const ankiModel = this.properties["anki-model"] || "Basic";
        if (Object.keys(fieldContent).length === 0) {
            if (ankiModel.toLowerCase().includes("cloze")) {
                fieldContent["Text"] = mainContent;
            } else {
                fieldContent["Front"] = mainContent;
                fieldContent["Back"] = await this.getFieldContent("children");
            }
        }

        // Store custom field data in hidden divs
        const html = `
            <div class="anki-custom-data" style="display:none">
                <div class="anki-model">${ankiModel}</div>
                <div class="anki-fields">${JSON.stringify(fieldContent)}</div>
            </div>
            ${mainContent}
        `;

        return {
            html,
            assets,
            tags
        };
    }

    public static async getNotesFromLogseqBlocks(
        otherNotes: Array<Note>,
    ): Promise<MultilineCardNote[]> {
        const logseqCard_blocks = await LogseqProxy.DB.datascriptQueryBlocks(`
        [:find (pull ?b [*])
        :where
        [?p :block/name "card"]
        [?b :block/refs ?p]
        ]`);
        const flashCard_blocks = await LogseqProxy.DB.datascriptQueryBlocks(`
        [:find (pull ?b [*])
        :where
        [?p :block/name "flashcard"]
        [?b :block/refs ?p]
        ]`);
        let logseqCardGroup_blocks = await LogseqProxy.DB.datascriptQueryBlocks(`
        [:find (pull ?b [*])
        :where
        [?r :block/name "card-group"]
        [?p :block/refs ?r]
        [?b :block/parent ?p]
        ]`);
        logseqCardGroup_blocks = await Promise.all(
            logseqCardGroup_blocks.map(async (block) => {
                const blockEntity = block[0] as ExtendedBlockEntity;
                const uuid = getUUIDFromBlock(blockEntity);
                const parent = blockEntity.parent?.id;
                const parentBlock = parent ? await LogseqProxy.Editor.getBlock(parent) : null;
                const tags = parentBlock ? await MultilineCardNote.getRelevantTags(
                    (parentBlock as ExtendedBlockEntity).refs?.map((ref) => ref.id) || []
                ) : [];
                blockEntity.tagsFromParentCardGroup = [...tags];
                return block;
            }),
        );
        let blocks: any = [
            ...logseqCard_blocks,
            ...flashCard_blocks,
            ...logseqCardGroup_blocks,
        ];
        let notes = await Promise.all(
            blocks.map(async (block) => {
                const blockEntity = block[0] as ExtendedBlockEntity;
                const uuid = getUUIDFromBlock(blockEntity);
                const page = blockEntity.page
                    ? await LogseqProxy.Editor.getPage(blockEntity.page.id)
                    : {};
                const tagsFromParentCardGroup = blockEntity.tagsFromParentCardGroup || [];
                const fullBlock = await LogseqProxy.Editor.getBlock(uuid, {
                    includeChildren: true,
                }) as ExtendedBlockEntity;
                if (fullBlock) {
                    const tags = await MultilineCardNote.getRelevantTags(
                        fullBlock.refs?.map((ref) => ref.id) || []
                    );
                    return new MultilineCardNote(
                        uuid,
                        fullBlock.content,
                        fullBlock.format,
                        fullBlock.properties || {},
                        page,
                        // Apply tags in parent card group block - #168
                        tags && tags.length > 0 ? tags : tagsFromParentCardGroup,
                        fullBlock.children || [],
                        fullBlock.refs?.map((ref) => ref.id) || []
                    );
                } else {
                    return null;
                }
            }),
        );
        console.log("MultilineCardNote Loaded");
        notes = await Note.removeUnwantedNotes(notes);
        notes = _.filter(notes, (note) => {
            // Retain only blocks whose children count > 0 or direction is expictly specifed or no other note type is being generated from that block
            return (
                _.get(note, "properties.direction") ||
                note.tags.includes("forward") ||
                note.tags.includes("bidirectional") ||
                note.tags.includes("reversed") ||
                note.children.length > 0 ||
                !_.find(otherNotes, {uuid: note.uuid})
            );
        });
        return notes;
    }

    public getBlockDependencies(): DependencyEntity[] {
        function getChildrenUUID(children: ExtendedBlockEntity[]): BlockUUID[] {
            let result: BlockUUID[] = [];
            for (const child of children) {
                result.push(child.uuid);
                if (child.children?.length > 0) {
                    result = result.concat(getChildrenUUID(child.children));
                }
            }
            return result;
        }
        return [this.uuid, ...getChildrenUUID(this.children)].map(
            (block) => ({type: "Block", value: block}) as DependencyEntity,
        );
    }

    public static async getBlocksFromLogseq(): Promise<ExtendedBlockEntity[]> {
        return [];
    }
}
