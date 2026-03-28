using Aryx.AgentHost.Contracts;
using Aryx.AgentHost.Services;
using GitHub.Copilot.SDK;
using Microsoft.Extensions.AI;

namespace Aryx.AgentHost.Tests;

public sealed class AryxCopilotAgentMessageOptionsTests
{
    [Fact]
    public async Task ProcessMessageAttachmentsAsync_MapsProtocolAttachmentsAndMessageMode()
    {
        string attachmentPath = Path.GetFullPath(Path.Combine(Path.GetTempPath(), "aryx-tests", "assets", "diagram.png"));
        ChatMessage message = new(ChatRole.User, "Please inspect these images.");
        message.Contents.Add(new AIContent
        {
            RawRepresentation = new ChatMessageAttachmentDto
            {
                Type = "file",
                Path = attachmentPath,
                DisplayName = "diagram.png",
            },
        });
        message.Contents.Add(new AIContent
        {
            RawRepresentation = new ChatMessageAttachmentDto
            {
                Type = "blob",
                Data = "QUJDRA==",
                MimeType = "image/png",
                DisplayName = "clipboard.png",
            },
        });
        message.Contents.Add(new AIContent
        {
            RawRepresentation = new CopilotMessageOptionsMetadata("immediate"),
        });

        (List<UserMessageDataAttachmentsItem>? attachments, string? messageMode, string? tempDir) =
            await AryxCopilotAgent.ProcessMessageAttachmentsAsync([message], CancellationToken.None);

        Assert.Equal("immediate", messageMode);
        Assert.Null(tempDir);

        Assert.NotNull(attachments);
        Assert.Collection(
            attachments!,
            first =>
            {
                UserMessageDataAttachmentsItemFile file = Assert.IsType<UserMessageDataAttachmentsItemFile>(first);
                Assert.Equal(attachmentPath, file.Path);
                Assert.Equal("diagram.png", file.DisplayName);
            },
            second =>
            {
                UserMessageDataAttachmentsItemBlob blob = Assert.IsType<UserMessageDataAttachmentsItemBlob>(second);
                Assert.Equal("QUJDRA==", blob.Data);
                Assert.Equal("image/png", blob.MimeType);
                Assert.Equal("clipboard.png", blob.DisplayName);
            });
    }

    [Fact]
    public async Task ProcessMessageAttachmentsAsync_RejectsRelativeFileAttachments()
    {
        ChatMessage message = new(ChatRole.User, "Inspect this file.");
        message.Contents.Add(new AIContent
        {
            RawRepresentation = new ChatMessageAttachmentDto
            {
                Type = "file",
                Path = "relative\\image.png",
            },
        });

        InvalidOperationException error = await Assert.ThrowsAsync<InvalidOperationException>(() =>
            AryxCopilotAgent.ProcessMessageAttachmentsAsync([message], CancellationToken.None));

        Assert.Contains("absolute", error.Message, StringComparison.OrdinalIgnoreCase);
    }
}

