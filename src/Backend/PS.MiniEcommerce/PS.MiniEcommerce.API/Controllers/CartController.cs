using MediatR;
using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using PS.MiniEcommerce.Application.Carts.Queries;

namespace PS.MiniEcommerce.API.Controllers;

[ApiController]
[Route("api/cart")]
[Authorize]
public class CartController : ControllerBase
{
    private readonly IMediator _mediator;

    public CartController(IMediator mediator)
    {
        _mediator = mediator;
    }

    [HttpGet]
    public async Task<IActionResult> GetCart(CancellationToken cancellationToken = default)
    {
        var result = await _mediator.Send(new GetCartQuery(), cancellationToken);

        Response.Headers.ETag = $"\"{result.Version}\"";

        return Ok(result.Cart);
    }
}
