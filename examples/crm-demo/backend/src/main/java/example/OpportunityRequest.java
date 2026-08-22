package example;
import jakarta.validation.constraints.NotBlank;
public class OpportunityRequest {
  @NotBlank
  private String name;
}
