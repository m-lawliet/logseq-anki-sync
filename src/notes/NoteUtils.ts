/**
 * Contains util functions
 */
import {LogseqProxy} from "../logseq/LogseqProxy";

export class NoteUtils {
    public static async matchTagNamesWithTagIds(
        tagIds: number[],
        tagNames: string[],
    ): Promise<string[]> {
        const tagIdsSet = new Set(tagIds);
        const result: string[] = [];
        for (let tagName of tagNames) {
            let tagPage;
            tagPage = await LogseqProxy.Editor.getPage(tagName);
            if (tagPage && tagPage.id && tagIdsSet.has(tagPage.id)) result.push(tagName);
        }
        return result;
    }
}
