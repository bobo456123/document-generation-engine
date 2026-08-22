package example;
import org.springframework.web.bind.annotation.*;
@RestController
@RequestMapping("/api/opportunities")
public class OpportunityController {
  private final OpportunityService opportunityService;
  public OpportunityController(OpportunityService opportunityService) { this.opportunityService = opportunityService; }
  @PostMapping
  @org.springframework.security.access.prepost.PreAuthorize("hasRole('SALES')")
  public Opportunity create(@RequestBody OpportunityRequest request) {
    return opportunityService.create(request);
  }
}
