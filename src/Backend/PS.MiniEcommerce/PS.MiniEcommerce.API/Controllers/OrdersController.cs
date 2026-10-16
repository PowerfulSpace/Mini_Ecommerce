using System.Security.Cryptography;
using System.Text;
using MediatR;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using PS.MiniEcommerce.Application.Checkout;
using PS.MiniEcommerce.Application.Checkout.Commands;

namespace PS.MiniEcommerce.API.Controllers;

[ApiController]
[Route("api/orders")]
[Authorize]
public class OrdersController : ControllerBase
{
    private readonly IMediator _mediator;

    public OrdersController(IMediator mediator)
    {
        _mediator = mediator;
    }

    [HttpPost]
    public async Task<IActionResult> Create(
        [FromHeader(Name = "Idempotency-Key")] string? idempotencyKey,
        [FromHeader(Name = "If-Match")] string? ifMatch,
        CancellationToken cancellationToken = default)
    {
        var fingerprint = ComputeFingerprint(ifMatch);

        var result = await _mediator.Send(
            new CheckoutCommand(idempotencyKey ?? string.Empty, ifMatch, fingerprint),
            cancellationToken);

        if (result.NewCartRowVersion is not null)
        {
            Response.Headers.ETag = $"\"{Convert.ToBase64String(result.NewCartRowVersion)}\"";
        }

        if (result.Success && result.OrderId is not null)
        {
            Response.Headers.Location = $"/api/orders/{result.OrderId}";
        }

        return new ContentResult
        {
            Content = result.ResponsePayload,
            ContentType = "application/json",
            StatusCode = result.ResponseStatusCode
        };
    }

    private static byte[] ComputeFingerprint(string? ifMatch)
    {
        var input = $"POST /api/orders\n{ifMatch ?? string.Empty}";
        var bytes = Encoding.UTF8.GetBytes(input);
        return SHA256.HashData(bytes);
    }
}
